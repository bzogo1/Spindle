import { renderWelcomeSeriesEmail, type WelcomeSeriesStep } from "@/emails"
import { sendSeriesEmail } from "@/lib/auth/mailer"
import { getCommunicationPreferences } from "@/lib/communication-preferences"
import { isUnsubscribed, normalizeEmail, unsubscribePageUrl } from "@/lib/email-unsubscribe"
import { siteUrl } from "@/lib/site-url"
import { logger } from "@/lib/logger"

/**
 * Email drip-series engine (welcome onboarding series).
 *
 * A "series" is an ordered list of steps, each with a delay measured from
 * enrollment (step 0) or from the previous step's send time. Enrollments live
 * in a process-local `Map` keyed by `(seriesId, normalized email)` — the same
 * interim-store pattern as `email-unsubscribe.ts` and
 * `communication-preferences.ts`. On multi-instance/serverless deploys each
 * instance keeps its own queue; a shared store (DB table) is the documented
 * upgrade path, and the public function signatures are already shaped for it.
 *
 * Scheduling: `processEmailSeriesQueue()` is the dispatch tick. Nothing calls
 * it automatically — a cron job, scheduler, or the
 * `POST /api/email-series/tick` route (bearer-authenticated) invokes it.
 * Recommended cadence: hourly is plenty for day-granularity delays.
 *
 * Gating, checked per step at send time:
 *  - `isUnsubscribed(email, EMAIL_SERIES_UNSUBSCRIBE_SCOPE)` — covers the
 *    series scope and the catch-all `"all"` opt-out. An unsubscribed address
 *    flips the enrollment to `"unsubscribed"` and no further steps send.
 *  - `productUpdates` communication preference — read via
 *    `getCommunicationPreferences(principal)` when the enrollment carries a
 *    principal (`user:<id>` / `mock:<email>`). Steps marked
 *    `requiresProductUpdates` are skipped (recorded, not sent) when the
 *    preference is off. When no principal is known the preference cannot be
 *    read and the step sends — enrollment callers that have a session
 *    principal should pass it.
 *
 * Every rendered email embeds `unsubscribePageUrl(...)`; the existing
 * `/unsubscribe` page + `/api/email/unsubscribe` route handle the opt-out.
 * Optionally, callers of that route may also invoke
 * `cancelEmailSeriesForEmail(email)` to immediately retire active
 * enrollments; the per-tick `isUnsubscribed` check already self-heals.
 */

export const WELCOME_SERIES_ID = "welcome"

/** Opt-out scope embedded in series unsubscribe links. `"all"` also opts out. */
export const EMAIL_SERIES_UNSUBSCRIBE_SCOPE = "welcome-series"

const DAY_MS = 24 * 60 * 60 * 1000

/** How long to wait before retrying a failed send. */
export const EMAIL_SERIES_RETRY_DELAY_MS = 60 * 60 * 1000
/** Consecutive failures after which a step is abandoned and the series moves on. */
export const EMAIL_SERIES_MAX_STEP_FAILURES = 3

export type EmailSeriesStepDefinition = {
  /** Stable step id recorded in `sentSteps`/`skippedSteps`/`failedSteps`. */
  id: string
  /** Template step passed to `renderWelcomeSeriesEmail`. */
  templateStep: WelcomeSeriesStep
  /** Delay before this step becomes due: step 0 is from enrollment, later steps from the previous send. */
  delayMs: number
  /** When true, the step is skipped if the recipient's `productUpdates` pref is off. */
  requiresProductUpdates: boolean
}

export const WELCOME_SERIES_STEPS: readonly EmailSeriesStepDefinition[] = [
  {
    id: "welcome",
    templateStep: "day-0",
    delayMs: 0,
    // The day-0 welcome is core onboarding, not a marketing nudge.
    requiresProductUpdates: false,
  },
  {
    id: "tips",
    templateStep: "day-3",
    delayMs: 3 * DAY_MS,
    requiresProductUpdates: true,
  },
  {
    id: "checklist",
    templateStep: "day-7",
    delayMs: 7 * DAY_MS,
    requiresProductUpdates: true,
  },
  {
    id: "upgrade",
    templateStep: "day-14",
    delayMs: 14 * DAY_MS,
    requiresProductUpdates: true,
  },
] as const

const SERIES_DEFINITIONS: Record<string, readonly EmailSeriesStepDefinition[]> = {
  [WELCOME_SERIES_ID]: WELCOME_SERIES_STEPS,
}

export type EmailSeriesStatus = "active" | "completed" | "unsubscribed" | "cancelled"

export type EmailSeriesEnrollment = {
  seriesId: string
  /** Normalized (lowercased, trimmed) recipient address. */
  email: string
  /** Session principal (`user:<id>` / `mock:<email>`) when known; gates prefs. */
  principal?: string
  /** Optional display name for personalization. */
  name?: string
  status: EmailSeriesStatus
  /** Index of the next step to attempt. */
  nextStepIndex: number
  /** Epoch ms when the next step becomes due. */
  nextSendAt: number
  sentSteps: string[]
  skippedSteps: string[]
  failedSteps: string[]
  /** Consecutive send failures for the current step (reset on success/advance). */
  stepFailures: number
  enrolledAt: number
  updatedAt: number
}

const enrollments = new Map<string, EmailSeriesEnrollment>()

function enrollmentKey(seriesId: string, email: string): string {
  return `${seriesId}${normalizeEmail(email)}`
}

function seriesSteps(seriesId: string): readonly EmailSeriesStepDefinition[] {
  const steps = SERIES_DEFINITIONS[seriesId]
  if (!steps) throw new Error(`Unknown email series: ${seriesId}`)
  return steps
}

function cloneEnrollment(enrollment: EmailSeriesEnrollment): EmailSeriesEnrollment {
  return {
    ...enrollment,
    sentSteps: [...enrollment.sentSteps],
    skippedSteps: [...enrollment.skippedSteps],
    failedSteps: [...enrollment.failedSteps],
  }
}

export type EnrollResult = {
  enrollment: EmailSeriesEnrollment
  /** True when an enrollment already existed — enrollment is idempotent. */
  alreadyEnrolled: boolean
}

/**
 * Enrolls `email` in a drip series. Idempotent: a second call for the same
 * `(seriesId, email)` returns the existing enrollment untouched, whatever its
 * status — a completed, cancelled, or unsubscribed enrollment is never reset
 * or resurrected by re-enrolling.
 *
 * The first step becomes due `steps[0].delayMs` after `now` (0 for the
 * welcome series, i.e. immediately on the next queue tick).
 */
export function enrollEmailSeries(input: {
  email: string
  seriesId?: string
  name?: string
  principal?: string
  now?: number
}): EnrollResult {
  const seriesId = input.seriesId ?? WELCOME_SERIES_ID
  const steps = seriesSteps(seriesId)
  const email = normalizeEmail(input.email)
  if (!email) throw new Error("enrollEmailSeries requires an email address")

  const key = enrollmentKey(seriesId, email)
  const existing = enrollments.get(key)
  if (existing) {
    return { enrollment: cloneEnrollment(existing), alreadyEnrolled: true }
  }

  const now = input.now ?? Date.now()
  const enrollment: EmailSeriesEnrollment = {
    seriesId,
    email,
    ...(input.principal ? { principal: input.principal } : {}),
    ...(input.name ? { name: input.name } : {}),
    status: "active",
    nextStepIndex: 0,
    nextSendAt: now + steps[0].delayMs,
    sentSteps: [],
    skippedSteps: [],
    failedSteps: [],
    stepFailures: 0,
    enrolledAt: now,
    updatedAt: now,
  }
  enrollments.set(key, enrollment)
  logger.info(
    { event: "email.series.enrolled", seriesId, stepCount: steps.length },
    "Email series enrollment created",
  )
  return { enrollment: cloneEnrollment(enrollment), alreadyEnrolled: false }
}

/** Returns a snapshot of the enrollment, or null when the address never enrolled. */
export function getEmailSeriesEnrollment(
  email: string,
  seriesId: string = WELCOME_SERIES_ID,
): EmailSeriesEnrollment | null {
  const enrollment = enrollments.get(enrollmentKey(seriesId, email))
  return enrollment ? cloneEnrollment(enrollment) : null
}

/**
 * Marks every active enrollment for `email` in `seriesId` as cancelled.
 * Intended as an optional hook for the unsubscribe flow; the per-tick
 * `isUnsubscribed` check already stops sends, so this is belt-and-braces.
 * Returns the number of enrollments cancelled.
 */
export function cancelEmailSeriesForEmail(
  email: string,
  seriesId: string = WELCOME_SERIES_ID,
): number {
  const key = enrollmentKey(seriesId, email)
  const enrollment = enrollments.get(key)
  if (!enrollment || enrollment.status !== "active") return 0
  enrollment.status = "cancelled"
  enrollment.updatedAt = Date.now()
  return 1
}

export type EmailSeriesQueueSummary = {
  /** Active enrollments examined this tick. */
  checked: number
  /** Steps successfully handed to the mailer. */
  sent: number
  /** Steps skipped (unsubscribed mid-series or productUpdates off). */
  skipped: number
  /** Steps abandoned after `EMAIL_SERIES_MAX_STEP_FAILURES` send failures. */
  failed: number
  /** Enrollments that finished all steps this tick. */
  completed: number
}

/** One rendered step ready for delivery. Injectable for tests. */
export type SeriesStepDelivery = {
  to: string
  subject: string
  text: string
  html: string
  linkPath: string
}

export type SeriesSendFn = (delivery: SeriesStepDelivery) => Promise<unknown>

function defaultSend(delivery: SeriesStepDelivery): Promise<unknown> {
  return sendSeriesEmail(delivery)
}

function advanceToNextStep(
  enrollment: EmailSeriesEnrollment,
  steps: readonly EmailSeriesStepDefinition[],
  fromIndex: number,
  baseTime: number,
): boolean {
  const nextIndex = fromIndex + 1
  enrollment.nextStepIndex = nextIndex
  enrollment.stepFailures = 0
  if (nextIndex >= steps.length) {
    enrollment.status = "completed"
    enrollment.nextSendAt = Number.POSITIVE_INFINITY
    return true
  }
  enrollment.nextSendAt = baseTime + steps[nextIndex].delayMs
  return false
}

/**
 * Sends every due step across all active enrollments. Processes at most one
 * step per enrollment per call — spacing between steps is enforced by
 * `nextSendAt`, so a backlog drains one email per enrollment per tick.
 *
 * `send` defaults to the real mailer (`sendSeriesEmail` → Resend); inject a
 * fake in tests. Send errors are retried after `EMAIL_SERIES_RETRY_DELAY_MS`
 * and abandoned after `EMAIL_SERIES_MAX_STEP_FAILURES` consecutive failures —
 * one bad address cannot stall the queue.
 */
export async function processEmailSeriesQueue(options?: {
  now?: number
  /** Max enrollments processed this tick. */
  limit?: number
  send?: SeriesSendFn
}): Promise<EmailSeriesQueueSummary> {
  const now = options?.now ?? Date.now()
  const limit = options?.limit ?? 100
  const send = options?.send ?? defaultSend
  const summary: EmailSeriesQueueSummary = {
    checked: 0,
    sent: 0,
    skipped: 0,
    failed: 0,
    completed: 0,
  }

  for (const enrollment of enrollments.values()) {
    if (summary.checked >= limit) break
    if (enrollment.status !== "active" || enrollment.nextSendAt > now) continue
    summary.checked += 1

    const steps = seriesSteps(enrollment.seriesId)
    const stepIndex = enrollment.nextStepIndex
    const step = steps[stepIndex]

    // Enrollment ran past the end (e.g. steps changed) — close it out.
    if (!step) {
      enrollment.status = "completed"
      enrollment.nextSendAt = Number.POSITIVE_INFINITY
      enrollment.updatedAt = now
      summary.completed += 1
      continue
    }

    // Unsubscribe check first: an opted-out address stops the whole series.
    if (isUnsubscribed(enrollment.email, EMAIL_SERIES_UNSUBSCRIBE_SCOPE)) {
      enrollment.status = "unsubscribed"
      enrollment.updatedAt = now
      summary.skipped += 1
      logger.info(
        { event: "email.series.unsubscribed", seriesId: enrollment.seriesId },
        "Email series stopped: address unsubscribed",
      )
      continue
    }

    // Communication preferences: marketing-ish steps honor productUpdates.
    // When the principal is unknown the preference cannot be read — send.
    if (
      step.requiresProductUpdates &&
      enrollment.principal &&
      !getCommunicationPreferences(enrollment.principal).productUpdates
    ) {
      enrollment.skippedSteps.push(step.id)
      const done = advanceToNextStep(enrollment, steps, stepIndex, now)
      enrollment.updatedAt = now
      summary.skipped += 1
      if (done) summary.completed += 1
      continue
    }

    const unsubscribeUrl = unsubscribePageUrl({
      email: enrollment.email,
      origin: siteUrl,
      scope: EMAIL_SERIES_UNSUBSCRIBE_SCOPE,
    })
    const rendered = renderWelcomeSeriesEmail({
      step: step.templateStep,
      ...(enrollment.name ? { name: enrollment.name } : {}),
      unsubscribeUrl,
      appUrl: `${siteUrl}/app`,
    })

    try {
      await send({
        to: enrollment.email,
        subject: rendered.subject,
        text: rendered.text,
        html: rendered.html,
        linkPath: "/app",
      })
      enrollment.sentSteps.push(step.id)
      const done = advanceToNextStep(enrollment, steps, stepIndex, now)
      enrollment.updatedAt = now
      summary.sent += 1
      if (done) summary.completed += 1
    } catch (error) {
      enrollment.stepFailures += 1
      enrollment.updatedAt = now
      if (enrollment.stepFailures >= EMAIL_SERIES_MAX_STEP_FAILURES) {
        enrollment.failedSteps.push(step.id)
        const done = advanceToNextStep(enrollment, steps, stepIndex, now)
        summary.failed += 1
        if (done) summary.completed += 1
        logger.warn(
          {
            event: "email.series.step_abandoned",
            seriesId: enrollment.seriesId,
            step: step.id,
            failures: enrollment.stepFailures,
          },
          "Email series step abandoned after repeated send failures",
        )
      } else {
        enrollment.nextSendAt = now + EMAIL_SERIES_RETRY_DELAY_MS
        logger.warn(
          {
            event: "email.series.send_failed",
            seriesId: enrollment.seriesId,
            step: step.id,
            attempt: enrollment.stepFailures,
            err: error,
          },
          "Email series step failed; will retry",
        )
      }
    }
  }

  return summary
}

/** Test hook: clears every enrollment. */
export function resetEmailSeriesForTests(): void {
  enrollments.clear()
}
