import { createContactReference } from "@/lib/site-forms"
import type { ContactTopic } from "@/lib/site-form-constants"

/**
 * Contact submission routing + inbox store.
 *
 * Every accepted `/api/contact` submission is recorded here and assigned to a
 * deterministic queue so the `/app/admin/contact` inbox can triage it. Two
 * layers decide the queue:
 *
 *  1. **Keyword rules** on subject+message — checked first because explicit
 *     intent in the text ("invoice", "press", "demo") is more specific than
 *     the coarse topic dropdown. First matching rule wins.
 *  2. **Topic mapping** — the fallback when no keyword fires:
 *     `product` → support, `billing` → billing, `security` → security,
 *     `general`/`other` → general.
 *
 * DEVELOPMENT SEAM: state lives in a process-local `Map`, same interim-store
 * pattern as `newsletter-store.ts`. Per-instance only — submissions recorded
 * on one instance are invisible to others and everything is lost on restart.
 * The upgrade path is a `ContactSubmission` table; the exported signatures
 * are already shaped for that swap. Bounded at
 * `CONTACT_STORE_MAX_SUBMISSIONS` records (oldest evicted first).
 *
 * Server-only in practice: imported by route handlers and API tests; client
 * components must not import it at runtime (it pulls in `site-forms`, which
 * builds zod schemas). The inbox UI uses `import type` only.
 */

export const CONTACT_STORE_MAX_SUBMISSIONS = 500
/** Stored alongside the full `message` so list views never ship 5 KB rows. */
export const MESSAGE_PREVIEW_LENGTH = 280

export const CONTACT_QUEUES = [
  "support",
  "sales",
  "billing",
  "security",
  "press",
  "general",
] as const
export type ContactQueue = (typeof CONTACT_QUEUES)[number]

export const CONTACT_QUEUE_LABELS: Record<ContactQueue, string> = {
  support: "Support",
  sales: "Sales",
  billing: "Billing",
  security: "Security",
  press: "Press",
  general: "General",
}

export const CONTACT_SUBMISSION_STATUSES = ["new", "in_progress", "resolved", "spam"] as const
export type ContactSubmissionStatus = (typeof CONTACT_SUBMISSION_STATUSES)[number]

export interface ContactSubmission {
  /** Same `CT-XXXXXXXX` format the visitor sees as their ticket reference. */
  id: string
  name: string
  email: string
  topic: ContactTopic
  subject: string
  /** Full message body (bounded by the contact schema's messageMax). */
  message: string
  /** First MESSAGE_PREVIEW_LENGTH chars of `message`, for list rows. */
  messagePreview: string
  /** Visitor-supplied order/account/company reference, when provided. */
  reference?: string
  routedTo: ContactQueue
  status: ContactSubmissionStatus
  /** Admin handle recorded by `updateSubmissionStatus`, when set. */
  assignee?: string
  /** Spam signal codes that flagged this submission (verdict != "pass"). */
  spamSignals?: string[]
  /** ISO timestamps. */
  createdAt: string
  updatedAt: string
}

export interface RouteSubmissionInput {
  /** Defaults to a fresh `createContactReference()` id. */
  id?: string
  name: string
  email: string
  topic: ContactTopic
  subject: string
  message: string
  reference?: string
  /** Defaults to "new"; the route passes "spam" for flagged submissions. */
  status?: ContactSubmissionStatus
  spamSignals?: readonly string[]
  assignee?: string
}

export interface ContactSubmissionFilter {
  status?: ContactSubmissionStatus
  queue?: ContactQueue
  /** Case-insensitive substring over name, email, subject, message, and id. */
  query?: string
  limit?: number
  offset?: number
}

export interface ContactSubmissionListResult {
  items: ContactSubmission[]
  total: number
}

/**
 * Keyword → queue rules, evaluated in order against `subject + "\n" + message`.
 * Patterns are deliberately word-boundaried so e.g. "billing" inside a longer
 * token does not fire; `\w*` suffixes cover inflections.
 */
const KEYWORD_QUEUE_RULES: ReadonlyArray<{ queue: ContactQueue; pattern: RegExp }> = [
  {
    queue: "security",
    pattern:
      /\b(vulnerabilit\w*|exploit\w*|breach\w*|cve-\d+|gdpr|hipaa|phishing|malware|ransomware|zero-?day\w*|pentest\w*|security incident)\b/i,
  },
  {
    queue: "billing",
    pattern:
      /\b(invoices?|billing|payments?|refunds?|chargebacks?|charged|overcharg\w*|receipts?|subscriptions?|double.?charg\w*|pricing (?:is )?wrong)\b/i,
  },
  {
    queue: "press",
    pattern:
      /\b(press|media (?:inquiry|request|outlet)|journalists?|newsroom|pr (?:request|inquiry)|interview\w*|press kit)\b/i,
  },
  {
    queue: "sales",
    pattern:
      /\b(sales|pricing|quotes?|demos?|trials?|enterprise|purchas\w*|buy|discounts?|partners?|upgrade)\b/i,
  },
]

/** Topic fallback used when no keyword rule matches. */
const TOPIC_QUEUE: Record<ContactTopic, ContactQueue> = {
  general: "general",
  product: "support",
  billing: "billing",
  security: "security",
  other: "general",
}

/**
 * Pure routing decision: keyword rules on subject+message first, topic
 * mapping as the fallback. Exported so tests (and a future rule editor) can
 * exercise the engine without touching the store.
 */
export function assignQueue(input: {
  topic: ContactTopic
  subject?: string
  message?: string
}): ContactQueue {
  const text = `${input.subject ?? ""}\n${input.message ?? ""}`
  for (const rule of KEYWORD_QUEUE_RULES) {
    if (rule.pattern.test(text)) return rule.queue
  }
  return TOPIC_QUEUE[input.topic] ?? "general"
}

const submissions = new Map<string, ContactSubmission>() // id → record, insertion-ordered

function nowIso(): string {
  return new Date().toISOString()
}

function messagePreview(message: string): string {
  const trimmed = message.trim()
  return trimmed.length <= MESSAGE_PREVIEW_LENGTH
    ? trimmed
    : `${trimmed.slice(0, MESSAGE_PREVIEW_LENGTH)}…`
}

/**
 * Records a contact submission and returns the stored record. `routedTo` is
 * always populated by `assignQueue`, even for spam-flagged submissions, so
 * the inbox can show where the message *would* have gone.
 */
export function routeSubmission(input: RouteSubmissionInput): ContactSubmission {
  const id = input.id?.trim() || createContactReference()
  const now = nowIso()
  const submission: ContactSubmission = {
    id,
    name: input.name,
    email: input.email,
    topic: input.topic,
    subject: input.subject,
    message: input.message,
    messagePreview: messagePreview(input.message),
    ...(input.reference?.trim() ? { reference: input.reference.trim() } : {}),
    routedTo: assignQueue({
      topic: input.topic,
      subject: input.subject,
      message: input.message,
    }),
    status: input.status ?? "new",
    ...(input.assignee?.trim() ? { assignee: input.assignee.trim() } : {}),
    ...(input.spamSignals && input.spamSignals.length > 0
      ? { spamSignals: [...input.spamSignals] }
      : {}),
    createdAt: now,
    updatedAt: now,
  }

  // Bounded capacity: evict the oldest record (Map preserves insertion order)
  // so a flood of submissions cannot grow memory without limit.
  if (submissions.size >= CONTACT_STORE_MAX_SUBMISSIONS && !submissions.has(id)) {
    const oldest = submissions.keys().next().value
    if (oldest !== undefined) submissions.delete(oldest)
  }
  submissions.set(id, submission)
  return submission
}

function matchesQuery(submission: ContactSubmission, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  return [
    submission.id,
    submission.name,
    submission.email,
    submission.subject,
    submission.message,
  ].some((field) => field.toLowerCase().includes(needle))
}

/**
 * Returns submissions newest-first, filtered by status, queue, and/or a
 * case-insensitive search over the identifying fields. `limit`/`offset`
 * paginate the filtered set; `total` is the pre-pagination count.
 */
export function listSubmissions(filter: ContactSubmissionFilter = {}): ContactSubmissionListResult {
  const matched = [...submissions.values()]
    .filter(
      (submission) =>
        (!filter.status || submission.status === filter.status) &&
        (!filter.queue || submission.routedTo === filter.queue) &&
        matchesQuery(submission, filter.query ?? ""),
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))

  const offset = Math.max(0, filter.offset ?? 0)
  const limit = filter.limit ?? matched.length
  return {
    items: matched.slice(offset, offset + limit),
    total: matched.length,
  }
}

/** Single-record lookup for detail views; null when unknown or evicted. */
export function getSubmission(id: string): ContactSubmission | null {
  return submissions.get(id) ?? null
}

/**
 * Updates a submission's status (and optionally its assignee). Returns the
 * updated record, or null when `id` is unknown. Setting `assignee` to an
 * empty/whitespace string clears the field.
 */
export function updateSubmissionStatus(
  id: string,
  status: ContactSubmissionStatus,
  assignee?: string,
): ContactSubmission | null {
  const submission = submissions.get(id)
  if (!submission) return null
  submission.status = status
  if (assignee !== undefined) {
    const trimmed = assignee.trim()
    if (trimmed) submission.assignee = trimmed
    else delete submission.assignee
  }
  submission.updatedAt = nowIso()
  return submission
}

/** Test hook: clears all recorded submissions. */
export function clearContactSubmissions(): void {
  submissions.clear()
}
