import type { AuthBackend } from "@/lib/auth/backend"
import { sendEmail, type EmailMessage } from "@/lib/email"
import { isUnsubscribed } from "@/lib/email-unsubscribe"
import { listSubscribers, NEWSLETTER_STORE_MAX_SUBSCRIBERS } from "@/lib/newsletter-store"

/**
 * Win-back campaigns — targeted re-engagement emails for churned or inactive
 * users, managed from `/app/admin/win-back`.
 *
 * DEVELOPMENT SEAM: campaign state lives in a process-local `Map`, the same
 * interim-store pattern as `newsletter-store.ts` / `email-scheduler.ts` /
 * `email-unsubscribe.ts`. On multi-instance or serverless deploys each
 * instance keeps its own copy and everything is lost on restart — the
 * upgrade path is `WinBackCampaign` / `WinBackSend` tables. The exported
 * function signatures are already shaped for that swap.
 *
 * SCHEDULING: nothing runs automatically. There is no cron or worker — an
 * admin triggers a send explicitly via `POST /api/admin/win-back/[id]` (the
 * "Run" action). A scheduled sweep is a documented follow-up.
 *
 * RECIPIENTS: `findInactiveUsers` is deliberately source-agnostic — the
 * caller injects a `WinBackUserSource` returning users with a best-effort
 * `lastActivityAt`. The default source ({@link defaultWinBackUserSource})
 * covers active newsletter subscribers enriched with auth-backend session
 * recency; there is no production user/activity datastore yet (same caveat
 * as `src/lib/retention.ts`), so a real activity feed plugs in through the
 * same seam. Opt-outs are ALWAYS honored before sending: a candidate is
 * suppressed when `isUnsubscribed` reports an opt-out in the `"marketing"`
 * or `"newsletter"` scope (the `"all"` catch-all is covered by both).
 *
 * Server-only: imported by route handlers and API tests; client components
 * must not import it (it pulls in `email.ts` → `env.server`).
 */

export const WIN_BACK_STATUSES = ["draft", "active", "paused", "completed"] as const
export type WinBackCampaignStatus = (typeof WIN_BACK_STATUSES)[number]

export function isWinBackStatus(value: string): value is WinBackCampaignStatus {
  return (WIN_BACK_STATUSES as readonly string[]).includes(value)
}

/** Hard cap on stored campaigns so the in-memory store cannot grow unboundedly. */
export const WIN_BACK_MAX_CAMPAIGNS = 200
/** Cap on candidates processed per run so one click cannot fan out unboundedly. */
export const WIN_BACK_MAX_CANDIDATES_PER_RUN = 500
export const WIN_BACK_DEFAULT_MIN_INACTIVE_DAYS = 30
export const WIN_BACK_MIN_INACTIVE_DAYS = 1
export const WIN_BACK_MAX_MIN_INACTIVE_DAYS = 3650
/** Provider `churnRisk` scores at/above this count toward `stats.churnRisk`. */
export const WIN_BACK_CHURN_RISK_THRESHOLD = 0.5

const DAY_MS = 24 * 60 * 60 * 1000

export interface WinBackStats {
  sent: number
  suppressed: number
  failed: number
  /** Candidates (at last run) whose provider churnRisk met the threshold. */
  churnRisk?: number
}

export interface WinBackRunSummary {
  /** ISO timestamp of the run. */
  at: string
  /** Inactive candidates found (pre-cap). */
  candidates: number
  /** Actually emailed (sendEmail returned "sent"). */
  sent: number
  /** Skipped due to unsubscribe opt-outs. */
  suppressed: number
  /** sendEmail threw or returned "unconfigured". */
  failed: number
}

export interface WinBackCampaign {
  id: string
  name: string
  status: WinBackCampaignStatus
  subject: string
  /**
   * Plain-text body template. `{{name}}` is interpolated with the
   * recipient's display name (HTML-escaped in the HTML rendering).
   */
  bodyTemplate: string
  minInactiveDays: number
  /** Optional audience label recorded for a future segment filter. */
  targetSegment?: string
  /** ISO timestamp. */
  createdAt: string
  stats: WinBackStats
  lastRun?: WinBackRunSummary
}

/** Raw user row a {@link WinBackUserSource} returns before inactivity filtering. */
export interface WinBackUserRecord {
  id: string
  /** Normalized (lowercased, trimmed) address — the dedupe key. */
  email: string
  name?: string | null
  /** ISO timestamp the account was created; the inactivity floor. */
  createdAt: string
  /** ISO timestamp of last observed activity; null/absent = never observed. */
  lastActivityAt?: string | null
  /** Optional 0..1 churn-likelihood score supplied by the source. */
  churnRisk?: number
}

export type WinBackUserSource = (input: {
  minInactiveDays: number
  now: number // epoch ms
}) => Promise<WinBackUserRecord[]> | WinBackUserRecord[]

export interface WinBackCandidate extends WinBackUserRecord {
  /** Whole days since the most recent of `lastActivityAt`/`createdAt`. */
  daysInactive: number
}

export type WinBackSendFn = (message: EmailMessage) => Promise<"sent" | "unconfigured">

export interface WinBackRunOptions {
  /** Injectable for tests; defaults to `sendEmail`. */
  send?: WinBackSendFn
  /** Injectable for tests; defaults to {@link defaultWinBackUserSource}. */
  userSource?: WinBackUserSource
  /**
   * Optional per-recipient unsubscribe URL builder. When provided, the link
   * is appended to the text and HTML bodies so recipients can opt out.
   */
  unsubscribeUrl?: (email: string) => string | undefined
  now?: number // epoch ms; injectable for tests
}

export interface WinBackRunResult {
  campaign: WinBackCampaign
  candidates: number
  sent: number
  suppressed: number
  failed: number
}

export class WinBackError extends Error {
  readonly code: "invalid" | "not_found" | "immutable"
  constructor(code: "invalid" | "not_found" | "immutable", message: string) {
    super(message)
    this.name = "WinBackError"
    this.code = code
  }
}

const campaigns = new Map<string, WinBackCampaign>() // id → record (insertion order)

function campaignId(): string {
  return `wb_${crypto.randomUUID()}`
}

function nowIso(): string {
  return new Date().toISOString()
}

function validateMinInactiveDays(value: number): number {
  if (!Number.isFinite(value)) {
    throw new WinBackError("invalid", "minInactiveDays must be a number.")
  }
  const days = Math.trunc(value)
  if (days < WIN_BACK_MIN_INACTIVE_DAYS || days > WIN_BACK_MAX_MIN_INACTIVE_DAYS) {
    throw new WinBackError(
      "invalid",
      `minInactiveDays must be between ${WIN_BACK_MIN_INACTIVE_DAYS} and ${WIN_BACK_MAX_MIN_INACTIVE_DAYS}.`,
    )
  }
  return days
}

function emptyStats(): WinBackStats {
  return { sent: 0, suppressed: 0, failed: 0 }
}

/**
 * Creates a draft campaign. `status` always starts as `"draft"`; transitions
 * go through {@link updateCampaign}.
 */
export function createCampaign(input: {
  name: string
  subject: string
  bodyTemplate: string
  minInactiveDays: number
  targetSegment?: string
}): WinBackCampaign {
  const name = input.name.trim()
  const subject = input.subject.trim()
  const bodyTemplate = input.bodyTemplate.trim()
  if (!name) throw new WinBackError("invalid", "Name is required.")
  if (!subject) throw new WinBackError("invalid", "Subject is required.")
  if (!bodyTemplate) throw new WinBackError("invalid", "Body template is required.")

  const campaign: WinBackCampaign = {
    id: campaignId(),
    name,
    status: "draft",
    subject,
    bodyTemplate,
    minInactiveDays: validateMinInactiveDays(input.minInactiveDays),
    ...(input.targetSegment?.trim() ? { targetSegment: input.targetSegment.trim() } : {}),
    createdAt: nowIso(),
    stats: emptyStats(),
  }

  if (campaigns.size >= WIN_BACK_MAX_CAMPAIGNS) {
    const oldest = campaigns.keys().next().value
    if (oldest !== undefined) campaigns.delete(oldest)
  }
  campaigns.set(campaign.id, campaign)
  return campaign
}

export interface WinBackCampaignFilter {
  status?: WinBackCampaignStatus
  limit?: number
  offset?: number
}

export interface WinBackCampaignListResult {
  items: WinBackCampaign[]
  total: number
}

/** Returns campaigns newest-first, filtered by status, with offset pagination. */
export function listCampaigns(filter: WinBackCampaignFilter = {}): WinBackCampaignListResult {
  const matched = [...campaigns.values()]
    .filter((campaign) => !filter.status || campaign.status === filter.status)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))

  const offset = Math.max(0, filter.offset ?? 0)
  const limit = Math.max(0, filter.limit ?? matched.length)
  return { items: matched.slice(offset, offset + limit), total: matched.length }
}

export function getCampaign(id: string): WinBackCampaign | null {
  return campaigns.get(id) ?? null
}

/**
 * Patches a campaign's editable fields and/or status. Status transitions are
 * free-form within the enum (admin tool); `"completed"` campaigns are
 * immutable so historical stats cannot be rewritten.
 */
export function updateCampaign(
  id: string,
  patch: {
    name?: string
    subject?: string
    bodyTemplate?: string
    minInactiveDays?: number
    targetSegment?: string | null
    status?: WinBackCampaignStatus
  },
): WinBackCampaign {
  const campaign = campaigns.get(id)
  if (!campaign) throw new WinBackError("not_found", "Campaign not found.")
  if (campaign.status === "completed") {
    throw new WinBackError("immutable", "Completed campaigns cannot be modified.")
  }

  if (patch.name !== undefined) {
    const name = patch.name.trim()
    if (!name) throw new WinBackError("invalid", "Name is required.")
    campaign.name = name
  }
  if (patch.subject !== undefined) {
    const subject = patch.subject.trim()
    if (!subject) throw new WinBackError("invalid", "Subject is required.")
    campaign.subject = subject
  }
  if (patch.bodyTemplate !== undefined) {
    const body = patch.bodyTemplate.trim()
    if (!body) throw new WinBackError("invalid", "Body template is required.")
    campaign.bodyTemplate = body
  }
  if (patch.minInactiveDays !== undefined) {
    campaign.minInactiveDays = validateMinInactiveDays(patch.minInactiveDays)
  }
  if (patch.targetSegment !== undefined) {
    const segment = patch.targetSegment?.trim()
    if (segment) campaign.targetSegment = segment
    else delete campaign.targetSegment
  }
  if (patch.status !== undefined) campaign.status = patch.status

  return campaign
}

/**
 * Filters a user source down to inactive candidates. A user counts as
 * inactive when the most recent of `lastActivityAt` and `createdAt` is at
 * least `minDays` old — `createdAt` is the floor so brand-new accounts with
 * no activity yet are not win-back targets. Results sort by `daysInactive`
 * descending. `churnRisk` scores pass through untouched.
 */
export async function findInactiveUsers(
  minDays: number,
  userSource: WinBackUserSource,
  now: number = Date.now(),
): Promise<WinBackCandidate[]> {
  const days = validateMinInactiveDays(minDays)
  const cutoff = now - days * DAY_MS
  const records = await userSource({ minInactiveDays: days, now })

  const candidates: WinBackCandidate[] = []
  for (const record of records) {
    const createdAt = Date.parse(record.createdAt)
    const lastActivity = record.lastActivityAt ? Date.parse(record.lastActivityAt) : NaN
    // Effective "last seen" is the newer of signup and last activity; an
    // unparseable timestamp counts as "never seen" only via createdAt.
    const lastSeen = Math.max(
      Number.isFinite(createdAt) ? createdAt : 0,
      Number.isFinite(lastActivity) ? lastActivity : 0,
    )
    if (lastSeen > 0 && lastSeen >= cutoff) continue // still active
    candidates.push({
      ...record,
      daysInactive: lastSeen > 0 ? Math.floor((now - lastSeen) / DAY_MS) : days,
    })
  }

  return candidates.sort(
    (a, b) => b.daysInactive - a.daysInactive || a.email.localeCompare(b.email),
  )
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

function interpolate(template: string, name: string): string {
  return template.replaceAll("{{name}}", name)
}

/**
 * Renders the campaign for one candidate. `{{name}}` is replaced with the
 * recipient's display name (falling back to "there"); the HTML body escapes
 * all interpolated user data. Plain-text paragraphs are wrapped in `<p>`
 * tags for a minimal multipart rendering.
 */
export function renderWinBackEmail(
  campaign: Pick<WinBackCampaign, "subject" | "bodyTemplate">,
  candidate: Pick<WinBackCandidate, "name" | "email">,
  unsubscribeUrl?: string,
): { subject: string; text: string; html: string } {
  const name = candidate.name?.trim() || "there"
  const subject = interpolate(campaign.subject, name)
  let text = interpolate(campaign.bodyTemplate, name)
  if (unsubscribeUrl) {
    text += `\n\nTo stop receiving these emails: ${unsubscribeUrl}`
  }

  const paragraphs = interpolate(campaign.bodyTemplate, name)
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => `<p>${escapeHtml(part).replace(/\n/g, "<br>")}</p>`)
    .join("\n")
  const unsubscribeHtml = unsubscribeUrl
    ? `\n<p><a href="${escapeHtml(unsubscribeUrl)}">Unsubscribe</a> from these emails.</p>`
    : ""
  const html = `${paragraphs}${unsubscribeHtml}`

  return { subject, text, html }
}

/** True when the candidate has opted out of win-back/marketing email. */
export function isWinBackSuppressed(email: string): boolean {
  // "marketing" and "newsletter" scopes; isUnsubscribed already folds in
  // the catch-all "all" scope for each check.
  return isUnsubscribed(email, "marketing") || isUnsubscribed(email, "newsletter")
}

/**
 * Executes a campaign once against the current inactive-user set.
 *
 * For every candidate (capped at {@link WIN_BACK_MAX_CANDIDATES_PER_RUN}):
 * opted-out addresses are counted `suppressed` and never touched; everyone
 * else gets `sendEmail` — `"sent"` increments `sent`, a throw or
 * `"unconfigured"` increments `failed`. Campaign `stats` accumulate across
 * runs and `lastRun` records the most recent outcome. Runs are allowed for
 * draft/active/paused campaigns; `"completed"` campaigns cannot run.
 */
export async function runCampaign(
  campaignIdValue: string,
  options: WinBackRunOptions = {},
): Promise<WinBackRunResult> {
  const campaign = campaigns.get(campaignIdValue)
  if (!campaign) throw new WinBackError("not_found", "Campaign not found.")
  if (campaign.status === "completed") {
    throw new WinBackError("immutable", "Completed campaigns cannot be run.")
  }

  const now = options.now ?? Date.now()
  const source = options.userSource ?? defaultWinBackUserSource
  const send = options.send ?? ((message: EmailMessage) => sendEmail(message))

  const found = await findInactiveUsers(campaign.minInactiveDays, source, now)
  const candidates = found.slice(0, WIN_BACK_MAX_CANDIDATES_PER_RUN)

  let sent = 0
  let suppressed = 0
  let failed = 0

  for (const candidate of candidates) {
    if (isWinBackSuppressed(candidate.email)) {
      suppressed += 1
      continue
    }
    const unsubscribeUrl = options.unsubscribeUrl?.(candidate.email)
    const message = renderWinBackEmail(campaign, candidate, unsubscribeUrl)
    try {
      const delivery = await send({ to: candidate.email, ...message })
      if (delivery === "sent") sent += 1
      else failed += 1 // "unconfigured": not delivered — recorded honestly
    } catch {
      failed += 1
    }
  }

  const churnRisk = candidates.filter(
    (candidate) =>
      typeof candidate.churnRisk === "number" &&
      candidate.churnRisk >= WIN_BACK_CHURN_RISK_THRESHOLD,
  ).length

  campaign.stats.sent += sent
  campaign.stats.suppressed += suppressed
  campaign.stats.failed += failed
  campaign.stats.churnRisk = churnRisk
  campaign.lastRun = {
    at: new Date(now).toISOString(),
    candidates: found.length,
    sent,
    suppressed,
    failed,
  }

  return {
    campaign,
    candidates: found.length,
    sent,
    suppressed,
    failed,
  }
}

/**
 * Default {@link WinBackUserSource}: active newsletter subscribers, enriched
 * with auth-backend session recency when the address resolves to a backend
 * user. Subscriber-only addresses fall back to `consentedAt` as `createdAt`
 * with no observed activity — old enough ones surface as candidates.
 *
 * This is the dev-seam audience: it deliberately covers the marketing-
 * reachable population. A production source should union real user/activity
 * tables; opt-out enforcement in `runCampaign` is unchanged either way.
 */
export const defaultWinBackUserSource: WinBackUserSource = async () => {
  const { items } = listSubscribers({
    status: "active",
    limit: NEWSLETTER_STORE_MAX_SUBSCRIBERS,
  })

  // Lazy import: the auth backend module graph is heavy and only needed on
  // the server path that actually resolves activity. Best-effort — when it
  // cannot load, subscribers still surface with subscriber-derived dates.
  let backend: AuthBackend | null
  try {
    const mod = await import("@/lib/auth/backend")
    backend = mod.getAuthBackend()
  } catch {
    backend = null
  }

  const byEmail = new Map<string, WinBackUserRecord>()
  for (const subscriber of items) {
    const email = subscriber.email
    if (byEmail.has(email)) continue

    let record: WinBackUserRecord = {
      id: subscriber.id,
      email,
      createdAt: subscriber.consentedAt,
      lastActivityAt: null,
    }

    if (backend) {
      try {
        const user = await backend.getUserByEmail(email)
        if (user) {
          const sessions = await backend.listSessions(user.id)
          const latest = sessions[0] // listSessions returns newest first
          record = {
            id: user.id,
            email,
            name: user.name,
            createdAt: user.createdAt,
            lastActivityAt: latest?.createdAt ?? null,
          }
        }
      } catch {
        // Backend lookup is best-effort enrichment; keep the subscriber row.
      }
    }

    byEmail.set(email, record)
  }

  return [...byEmail.values()]
}

/** Test hook: clears all campaigns (does not touch opt-outs or subscribers). */
export function clearWinBackStore(): void {
  campaigns.clear()
}
