/**
 * Outbound-email delivery tracking — the delivery-lifecycle ledger behind
 * `/app/admin/email-delivery`.
 *
 * DEVELOPMENT SEAM: state lives in a process-local `Map`, the same interim
 * store pattern as `email-scheduler.ts` / `newsletter-store.ts`. On
 * multi-instance or serverless deploys each instance keeps its own records
 * and everything is lost on restart — the upgrade path is an
 * `EmailDeliveryEvent` table (one row per event) or a column set on the
 * outbound-message table. The exported function signatures are already
 * shaped for that swap.
 *
 * There is no real provider integration: nothing calls this module today.
 * `trackEmailSend` is the documented wiring point — send paths
 * (`src/lib/email.ts` callers such as `email-scheduler.ts`,
 * `email-series.ts`, `newsletter-store.ts`) should call it before handing a
 * message to `sendEmail`, keep the returned `emailId`, and then call
 * `recordEvent` for `sent`/`bounced` outcomes. Provider webhooks
 * (`delivered`/`opened`/`clicked`/`complained`) would call `recordEvent`
 * with the same `emailId` once a provider is wired; until then events are
 * recorded manually or by tests.
 *
 * Rates caveat: `stats()` rates are EVENT-BASED approximations over the
 * in-memory records — they count records that ever saw an event type, they
 * are not unique-open/unique-click metrics and they do not deduplicate
 * repeat events. Treat them as a dev-seam signal, not analytics truth.
 *
 * Server-only: imported by route handlers and API tests; client components
 * must not import it.
 */

export const EMAIL_DELIVERY_EVENT_TYPES = [
  "queued",
  "sent",
  "delivered",
  "opened",
  "clicked",
  "bounced",
  "complained",
] as const
export type EmailDeliveryEventType = (typeof EMAIL_DELIVERY_EVENT_TYPES)[number]

/**
 * Derived lifecycle status. Normally the type of the latest event; once a
 * `bounced` or `complained` event lands the record is terminal-ish — later
 * events are still appended to the timeline but the status stays on the
 * terminal type (a bounce/complaint is never "un-bounced" by a stray
 * `opened` ping).
 */
export type EmailDeliveryStatus = EmailDeliveryEventType

export const TERMINAL_EVENT_TYPES: readonly EmailDeliveryEventType[] = ["bounced", "complained"]

export interface EmailDeliveryEvent {
  type: EmailDeliveryEventType
  /** ISO timestamp of the event. */
  at: string
  /** Optional provider/debug payload (e.g. smtp status, link id). */
  meta?: Record<string, unknown>
}

export interface EmailDeliveryRecord {
  emailId: string
  /** Normalized (lowercased, trimmed) recipient address. */
  to: string
  templateKey?: string
  /** Append-only lifecycle timeline, oldest first. */
  events: EmailDeliveryEvent[]
  status: EmailDeliveryStatus
  /** ISO timestamp of record creation. */
  createdAt: string
}

/** Input accepted by `recordEvent`; `to`/`templateKey` seed a new record. */
export interface EmailDeliveryEventInput {
  type: EmailDeliveryEventType
  /** ISO timestamp; defaults to now. */
  at?: string
  meta?: Record<string, unknown>
  /** Only used when the event creates the record. */
  to?: string
  templateKey?: string
}

export interface EmailDeliveryListFilter {
  status?: EmailDeliveryStatus
  /** Case-insensitive substring match on the recipient address. */
  to?: string
  limit?: number
  offset?: number
}

export interface EmailDeliveryListResult {
  items: EmailDeliveryRecord[]
  total: number
}

export interface EmailDeliveryStats {
  /** Total tracked records. */
  total: number
  /** Record count per derived status. */
  byStatus: Record<EmailDeliveryStatus, number>
  rates: {
    /**
     * Records that reached `delivered`/`opened`/`clicked` ÷ records that saw
     * `sent`. `null` when nothing was sent yet. Event-based approximation —
     * not a unique-delivery metric.
     */
    deliveryRate: number | null
    /** Records with `bounced` ÷ records that saw `sent`. `null` when denom 0. */
    bounceRate: number | null
    /**
     * Records that saw `opened`/`clicked` ÷ records that reached delivery.
     * `null` when nothing was delivered. Event-based — repeat opens count
     * once per record but this is still not a unique-open metric.
     */
    openRate: number | null
    /** Records with `complained` ÷ records that saw `sent`. */
    complaintRate: number | null
  }
}

/** Hard cap on tracked records so the in-memory store cannot grow unboundedly. */
export const EMAIL_DELIVERY_MAX_RECORDS = 1_000
/** Hard cap on events per record; oldest middle events are dropped past it. */
export const EMAIL_DELIVERY_MAX_EVENTS = 200

const records = new Map<string, EmailDeliveryRecord>() // emailId → record, insertion order

function deliveryEmailId(): string {
  return `del_${crypto.randomUUID()}`
}

function nowIso(): string {
  return new Date().toISOString()
}

function normalizeAddress(email: string): string {
  return email.trim().toLowerCase()
}

function clone(record: EmailDeliveryRecord): EmailDeliveryRecord {
  return {
    ...record,
    events: record.events.map((event) => ({
      ...event,
      ...(event.meta ? { meta: { ...event.meta } } : {}),
    })),
  }
}

function deriveStatus(events: readonly EmailDeliveryEvent[]): EmailDeliveryStatus {
  // Terminal-ish: the most recent bounced/complained event wins over any
  // later non-terminal noise.
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const type = events[i].type
    if ((TERMINAL_EVENT_TYPES as readonly string[]).includes(type)) return type
  }
  return events.length > 0 ? events[events.length - 1].type : "queued"
}

function refreshStatus(record: EmailDeliveryRecord): void {
  record.status = deriveStatus(record.events)
}

function createRecord(
  emailId: string,
  input: { to?: string; templateKey?: string },
): EmailDeliveryRecord {
  // The store is bounded: evict the oldest record (insertion order) when
  // full — delivery history is append-mostly, so oldest-first eviction is
  // the least surprising dev-seam behavior.
  if (records.size >= EMAIL_DELIVERY_MAX_RECORDS) {
    const oldest = records.keys().next().value
    if (oldest !== undefined) records.delete(oldest)
  }

  const record: EmailDeliveryRecord = {
    emailId,
    to: input.to ? normalizeAddress(input.to) : "unknown",
    ...(input.templateKey ? { templateKey: input.templateKey } : {}),
    events: [],
    status: "queued",
    createdAt: nowIso(),
  }
  records.set(emailId, record)
  return record
}

/**
 * Records one lifecycle event against `emailId`, creating the record when
 * it does not exist yet (`to`/`templateKey` on the input seed a fresh
 * record — pass them on the first event or use `trackEmailSend`). Unknown
 * ids are created rather than rejected, matching webhook-style usage where
 * the caller only knows the id it was given. Throws on an event type that
 * is not in `EMAIL_DELIVERY_EVENT_TYPES` (typed away at compile time).
 */
export function recordEvent(emailId: string, input: EmailDeliveryEventInput): EmailDeliveryRecord {
  if (!(EMAIL_DELIVERY_EVENT_TYPES as readonly string[]).includes(input.type)) {
    throw new Error(`Unknown email delivery event type: ${String(input.type)}`)
  }

  let record = records.get(emailId)
  if (!record) {
    record = createRecord(emailId, { to: input.to, templateKey: input.templateKey })
  } else if (input.to && record.to === "unknown") {
    record.to = normalizeAddress(input.to)
  }
  if (input.templateKey && !record.templateKey) {
    record.templateKey = input.templateKey
  }

  const event: EmailDeliveryEvent = {
    type: input.type,
    at: input.at ?? nowIso(),
    ...(input.meta ? { meta: { ...input.meta } } : {}),
  }

  // Per-record event cap: keep the first event (usually `queued`, the
  // creation context) and the most recent EMAIL_DELIVERY_MAX_EVENTS - 1.
  if (record.events.length >= EMAIL_DELIVERY_MAX_EVENTS) {
    record.events.splice(1, record.events.length - (EMAIL_DELIVERY_MAX_EVENTS - 1))
  }
  record.events.push(event)
  refreshStatus(record)
  return clone(record)
}

/**
 * Wiring point for send paths: call before handing a message to
 * `sendEmail`, then `recordEvent(emailId, { type: "sent" })` on success or
 * `{ type: "bounced" }` on provider rejection. Creates the record with a
 * `queued` event and returns `{ emailId, record }`.
 */
export function trackEmailSend(input: { to: string; templateKey?: string }): {
  emailId: string
  record: EmailDeliveryRecord
} {
  const emailId = deliveryEmailId()
  const record = recordEvent(emailId, {
    type: "queued",
    to: input.to,
    ...(input.templateKey ? { templateKey: input.templateKey } : {}),
  })
  return { emailId, record }
}

/** Returns one record by id (full event timeline), or null when unknown. */
export function getDelivery(emailId: string): EmailDeliveryRecord | null {
  const record = records.get(emailId)
  return record ? clone(record) : null
}

/**
 * Lists records most-recently-active first (last event timestamp desc,
 * falling back to createdAt), filtered by derived status and/or a
 * case-insensitive recipient substring, with offset pagination. `total` is
 * the pre-pagination count of the filtered set.
 */
export function listDeliveries(filter: EmailDeliveryListFilter = {}): EmailDeliveryListResult {
  const toNeedle = filter.to?.trim().toLowerCase()
  const matched = [...records.values()]
    .filter((record) => !filter.status || record.status === filter.status)
    .filter((record) => !toNeedle || record.to.toLowerCase().includes(toNeedle))
    .sort((a, b) => {
      const aLast = a.events[a.events.length - 1]?.at ?? a.createdAt
      const bLast = b.events[b.events.length - 1]?.at ?? b.createdAt
      return (
        bLast.localeCompare(aLast) ||
        b.createdAt.localeCompare(a.createdAt) ||
        b.emailId.localeCompare(a.emailId)
      )
    })

  const offset = Math.max(0, filter.offset ?? 0)
  const limit = filter.limit ?? matched.length
  return { items: matched.slice(offset, offset + limit).map(clone), total: matched.length }
}

function hasEvent(record: EmailDeliveryRecord, types: readonly EmailDeliveryEventType[]): boolean {
  return record.events.some((event) => (types as readonly string[]).includes(event.type))
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator
}

/**
 * Aggregate counts and event-based rate approximations over ALL tracked
 * records (unfiltered — the admin screen shows global health, not the
 * current page/filter). See the module docstring: rates are not
 * unique-open metrics.
 */
export function stats(): EmailDeliveryStats {
  const byStatus: Record<EmailDeliveryStatus, number> = {
    queued: 0,
    sent: 0,
    delivered: 0,
    opened: 0,
    clicked: 0,
    bounced: 0,
    complained: 0,
  }

  let sent = 0
  let delivered = 0
  let opened = 0
  let bounced = 0
  let complained = 0

  for (const record of records.values()) {
    byStatus[record.status] += 1
    if (hasEvent(record, ["sent"])) sent += 1
    if (hasEvent(record, ["delivered", "opened", "clicked"])) delivered += 1
    if (hasEvent(record, ["opened", "clicked"])) opened += 1
    if (hasEvent(record, ["bounced"])) bounced += 1
    if (hasEvent(record, ["complained"])) complained += 1
  }

  return {
    total: records.size,
    byStatus,
    rates: {
      deliveryRate: ratio(delivered, sent),
      bounceRate: ratio(bounced, sent),
      openRate: ratio(opened, delivered),
      complaintRate: ratio(complained, sent),
    },
  }
}

/** Test hook: clears every tracked delivery record. */
export function resetEmailDeliveryForTests(): void {
  records.clear()
}
