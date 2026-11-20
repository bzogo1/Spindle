import { z } from "zod"

import { sendEmail, type EmailMessage } from "@/lib/email"
import { logger } from "@/lib/logger"

/**
 * Scheduled outbound-email queue for the `/app/admin/email-schedule` screen.
 *
 * DEVELOPMENT SEAM: state lives in a process-local `Map`, the same interim-store
 * pattern as `newsletter-store.ts` / `email-series.ts`. On multi-instance or
 * serverless deploys each instance keeps its own queue and everything is lost
 * on restart — the upgrade path is a `ScheduledEmail` table. The exported
 * function signatures are already shaped for that swap.
 *
 * Scheduling: nothing calls `processDue()` automatically — there is no cron or
 * worker in this codebase. A scheduler tick is a documented follow-up (e.g. a
 * cron hitting `POST /api/admin/email-schedule/tick`, or an external scheduler
 * calling `processDue` directly). Until then the admin "Run due now" button on
 * the screen exercises the same seam.
 *
 * Delivery goes through `sendEmail` (`src/lib/email.ts` → Resend). That
 * function returns `"unconfigured"` (not a throw) when `RESEND_API_KEY` is
 * unset; `processDue` records that outcome honestly as `failed` with a
 * `lastError` explaining the message was not delivered, rather than marking it
 * `sent`.
 *
 * Server-only: imported by route handlers and API tests; client components
 * must not import it (it pulls in `email.ts` → `env.server`).
 */

export const SCHEDULED_EMAIL_STATUSES = ["scheduled", "sent", "failed", "canceled"] as const
export type ScheduledEmailStatus = (typeof SCHEDULED_EMAIL_STATUSES)[number]

/** Hard cap on queued entries so the in-memory store cannot grow unboundedly. */
export const EMAIL_SCHEDULE_MAX_ENTRIES = 500
/** Cap on body sizes to keep the dev-seam store reasonable. */
export const EMAIL_SCHEDULE_MAX_BODY_LENGTH = 50_000

export interface ScheduledEmail {
  id: string
  /** Normalized (lowercased, trimmed) recipient address. */
  to: string
  subject: string
  textBody?: string
  htmlBody?: string
  /**
   * Optional template identifier recorded for a future template-rendering
   * pass. Today it is stored metadata only — `processDue` sends
   * `textBody`/`htmlBody` verbatim.
   */
  templateKey?: string
  /** ISO timestamp; must be in the future at schedule time. */
  sendAt: string
  status: ScheduledEmailStatus
  /** Populated on `failed` (and on `sent` when delivery was unconfigured). */
  lastError?: string
  /** ISO timestamp of scheduling. */
  createdAt: string
  /** ISO timestamp set when the send attempt resolves `sent`. */
  sentAt?: string
}

export class EmailScheduleError extends Error {
  readonly code: "invalid" | "queue_full"
  constructor(code: "invalid" | "queue_full", message: string) {
    super(message)
    this.name = "EmailScheduleError"
    this.code = code
  }
}

/**
 * Input schema for `scheduleEmail`. `sendAt` must parse to a future instant —
 * the check runs against `Date.now()` at validation time, so routes should
 * call `scheduleEmail` (which re-validates) rather than trusting a cached
 * parse.
 */
export const scheduleEmailSchema = z
  .object({
    to: z.email("Enter a valid email address.").max(320),
    subject: z.string().trim().min(1, "Subject is required.").max(200, "Subject is too long."),
    sendAt: z
      .string()
      .trim()
      .min(1, "sendAt is required.")
      .refine((value) => !Number.isNaN(Date.parse(value)), "sendAt must be a valid date.")
      .refine((value) => Date.parse(value) > Date.now(), "sendAt must be in the future."),
    textBody: z.string().max(EMAIL_SCHEDULE_MAX_BODY_LENGTH, "Text body is too long.").optional(),
    htmlBody: z.string().max(EMAIL_SCHEDULE_MAX_BODY_LENGTH, "HTML body is too long.").optional(),
    templateKey: z.string().trim().max(120).optional(),
  })
  .refine(
    (value) =>
      Boolean(value.textBody?.trim()) ||
      Boolean(value.htmlBody?.trim()) ||
      Boolean(value.templateKey?.trim()),
    { message: "Provide a text body, an HTML body, or a template key." },
  )

export type ScheduleEmailInput = z.input<typeof scheduleEmailSchema>

export interface ScheduledEmailListFilter {
  status?: ScheduledEmailStatus
  limit?: number
  offset?: number
}

export interface ScheduledEmailListResult {
  items: ScheduledEmail[]
  total: number
}

const queue = new Map<string, ScheduledEmail>() // id → record, insertion order

function scheduledEmailId(): string {
  return `eml_${crypto.randomUUID()}`
}

function nowIso(): string {
  return new Date().toISOString()
}

function normalizeAddress(email: string): string {
  return email.trim().toLowerCase()
}

function clone(email: ScheduledEmail): ScheduledEmail {
  return { ...email }
}

/**
 * Validates and enqueues an email for later delivery. Throws
 * `EmailScheduleError` (`"invalid"` for schema/future-sendAt violations,
 * `"queue_full"` when the bounded store has no room) — callers map it to a
 * 400/409 response.
 */
export function scheduleEmail(input: unknown): ScheduledEmail {
  const parsed = scheduleEmailSchema.safeParse(input)
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "Invalid scheduled email."
    throw new EmailScheduleError("invalid", message)
  }

  // Bound the store: evict the oldest non-scheduled records first so send
  // history cannot starve the queue; if every record is still pending, refuse.
  if (queue.size >= EMAIL_SCHEDULE_MAX_ENTRIES) {
    for (const [id, record] of queue) {
      if (record.status !== "scheduled") queue.delete(id)
      if (queue.size < EMAIL_SCHEDULE_MAX_ENTRIES) break
    }
    if (queue.size >= EMAIL_SCHEDULE_MAX_ENTRIES) {
      throw new EmailScheduleError("queue_full", "The scheduled-email queue is full.")
    }
  }

  const data = parsed.data
  const email: ScheduledEmail = {
    id: scheduledEmailId(),
    to: normalizeAddress(data.to),
    subject: data.subject,
    ...(data.textBody !== undefined ? { textBody: data.textBody } : {}),
    ...(data.htmlBody !== undefined ? { htmlBody: data.htmlBody } : {}),
    ...(data.templateKey !== undefined ? { templateKey: data.templateKey } : {}),
    sendAt: new Date(Date.parse(data.sendAt)).toISOString(),
    status: "scheduled",
    createdAt: nowIso(),
  }
  queue.set(email.id, email)
  logger.info(
    { event: "email.schedule.created", id: email.id, sendAt: email.sendAt },
    "Scheduled email created",
  )
  return clone(email)
}

/** Returns one record by id, or null when unknown. */
export function getScheduledEmail(id: string): ScheduledEmail | null {
  const email = queue.get(id)
  return email ? clone(email) : null
}

/**
 * Lists records soonest-send first (send history keeps send order too),
 * filtered by status with offset pagination. `total` is the pre-pagination
 * count of the filtered set.
 */
export function listScheduled(filter: ScheduledEmailListFilter = {}): ScheduledEmailListResult {
  const matched = [...queue.values()]
    .filter((email) => !filter.status || email.status === filter.status)
    .sort(
      (a, b) =>
        a.sendAt.localeCompare(b.sendAt) ||
        a.createdAt.localeCompare(b.createdAt) ||
        a.id.localeCompare(b.id),
    )

  const offset = Math.max(0, filter.offset ?? 0)
  const limit = filter.limit ?? matched.length
  return { items: matched.slice(offset, offset + limit).map(clone), total: matched.length }
}

/**
 * Cancels a scheduled email. Only `"scheduled"` records can be cancelled —
 * returns `"not_found"` for unknown ids and `"not_scheduled"` for records
 * that already resolved (sent/failed/canceled).
 */
export function cancelScheduled(
  id: string,
): { ok: true; email: ScheduledEmail } | { ok: false; reason: "not_found" | "not_scheduled" } {
  const email = queue.get(id)
  if (!email) return { ok: false, reason: "not_found" }
  if (email.status !== "scheduled") return { ok: false, reason: "not_scheduled" }
  email.status = "canceled"
  return { ok: true, email: clone(email) }
}

export interface ProcessDueSummary {
  /** Due scheduled emails attempted this tick. */
  processed: number
  /** Attempts where the provider accepted the message. */
  sent: number
  /** Attempts that threw or resolved `"unconfigured"` (not delivered). */
  failed: number
}

/** One delivery attempt for a due record. Injectable for tests. */
export type ScheduledEmailSendFn = (message: EmailMessage) => Promise<unknown>

function defaultSend(message: EmailMessage): Promise<unknown> {
  return sendEmail(message)
}

function deliveryFor(email: ScheduledEmail): EmailMessage {
  return {
    to: email.to,
    subject: email.subject,
    // `text` is required by the mailer; fall back to the HTML body (or the
    // subject) so template-only records still produce a deliverable message.
    text: email.textBody ?? email.htmlBody ?? email.subject,
    ...(email.htmlBody ? { html: email.htmlBody } : {}),
  }
}

/**
 * Attempts delivery for every `"scheduled"` record whose `sendAt` is at or
 * before `now` (epoch ms, defaults to `Date.now()`). One attempt per record
 * per call — a failure marks the record `"failed"` terminally (no automatic
 * retry; reschedule by creating a new entry) so one bad address cannot stall
 * the queue.
 *
 * Send errors never propagate: each attempt is wrapped so a provider failure
 * is recorded on the record (`status: "failed"`, `lastError`) and the loop
 * continues. `send` defaults to `sendEmail` (Resend); inject a fake in tests.
 *
 * This is the scheduler seam — call it from a cron/worker when one exists,
 * or via `POST /api/admin/email-schedule/tick` for manual/admin runs.
 */
export async function processDue(
  now: number = Date.now(),
  options?: { send?: ScheduledEmailSendFn },
): Promise<ProcessDueSummary> {
  const send = options?.send ?? defaultSend
  const summary: ProcessDueSummary = { processed: 0, sent: 0, failed: 0 }

  for (const email of queue.values()) {
    if (email.status !== "scheduled") continue
    if (Date.parse(email.sendAt) > now) continue
    summary.processed += 1

    try {
      const delivery = await send(deliveryFor(email))
      if (delivery === "unconfigured") {
        // sendEmail no-ops without RESEND_API_KEY — record honestly rather
        // than claiming a delivery that never happened.
        email.status = "failed"
        email.lastError =
          "Email provider is not configured (RESEND_API_KEY missing); the message was not delivered."
        summary.failed += 1
        logger.warn(
          { event: "email.schedule.unconfigured", id: email.id },
          "Scheduled email skipped: mail provider unconfigured",
        )
        continue
      }
      email.status = "sent"
      email.sentAt = nowIso()
      delete email.lastError
      summary.sent += 1
      logger.info({ event: "email.schedule.sent", id: email.id }, "Scheduled email sent")
    } catch (error) {
      email.status = "failed"
      email.lastError = error instanceof Error ? error.message : String(error)
      summary.failed += 1
      logger.warn(
        { event: "email.schedule.failed", id: email.id, err: error },
        "Scheduled email send failed",
      )
    }
  }

  return summary
}

/** Test hook: clears every scheduled email. */
export function resetEmailScheduleForTests(): void {
  queue.clear()
}
