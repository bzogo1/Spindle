import {
  clearUnsubscribeStore,
  normalizeEmail,
  resubscribeAddress,
  unsubscribeAddress,
} from "@/lib/email-unsubscribe"

/**
 * Newsletter subscriber + campaign store for the public subscribe form and
 * the `/app/admin/newsletter` management screen.
 *
 * DEVELOPMENT SEAM: state lives in process-local `Map`s, same interim-store
 * pattern as `email-unsubscribe.ts` and `email-series.ts`. On serverless or
 * multi-instance deploys each instance keeps its own copy — a subscriber
 * recorded on one instance is invisible to the others, and everything is
 * lost on restart. The upgrade path is a `NewsletterSubscriber` /
 * `NewsletterCampaign` table (keyed by normalized email / id); the exported
 * function signatures are already shaped for that swap.
 *
 * The store deliberately composes with `email-unsubscribe.ts`: `unsubscribe`
 * also records a `"newsletter"`-scope opt-out there, so campaign sends can
 * consult `isUnsubscribed(email, "newsletter")` without reading this store.
 *
 * Server-only in practice: imported by route handlers and API tests; client
 * components must not import it (it pulls in `email-unsubscribe`, which
 * imports `env.server`).
 */

export const NEWSLETTER_STORE_MAX_SUBSCRIBERS = 5000
export const NEWSLETTER_STORE_MAX_CAMPAIGNS = 500
/** Campaign bodies are not persisted; only this many characters are kept. */
const BODY_PREVIEW_LENGTH = 160

export type NewsletterSubscriberStatus = "pending" | "active" | "unsubscribed"
export type NewsletterCampaignStatus = "draft" | "scheduled" | "sent"

export const NEWSLETTER_SUBSCRIBER_STATUSES: readonly NewsletterSubscriberStatus[] = [
  "pending",
  "active",
  "unsubscribed",
]

export const NEWSLETTER_CAMPAIGN_STATUSES: readonly NewsletterCampaignStatus[] = [
  "draft",
  "scheduled",
  "sent",
]

export interface NewsletterSubscriber {
  id: string
  /** Normalized (lowercased, trimmed) address — the dedupe key. */
  email: string
  /** Signup surface, e.g. "site-footer"; empty string when not provided. */
  source: string
  /** ISO timestamp of the most recent explicit consent. */
  consentedAt: string
  status: NewsletterSubscriberStatus
  /** ISO timestamp set when the subscriber opted out; absent otherwise. */
  unsubscribedAt?: string
}

export interface NewsletterCampaign {
  id: string
  subject: string
  /** First BODY_PREVIEW_LENGTH chars of the body; the full body is not stored. */
  bodyPreview?: string
  status: NewsletterCampaignStatus
  /** ISO timestamp. */
  createdAt: string
  /** Filled in when a send is recorded (delivery is a later task). */
  recipientCount?: number
}

export interface SubscriberListFilter {
  status?: NewsletterSubscriberStatus
  /** Case-insensitive substring match against email and source. */
  query?: string
  limit?: number
  offset?: number
}

export interface SubscriberListResult {
  items: NewsletterSubscriber[]
  total: number
}

export interface CampaignListFilter {
  limit?: number
  offset?: number
}

export interface CampaignListResult {
  items: NewsletterCampaign[]
  total: number
}

export interface NewsletterStats {
  subscribers: Record<NewsletterSubscriberStatus, number> & { total: number }
  campaigns: Record<NewsletterCampaignStatus, number> & { total: number }
}

const subscribers = new Map<string, NewsletterSubscriber>() // normalized email → record
const campaigns = new Map<string, NewsletterCampaign>() // id → record

function subscriberId(): string {
  return `sub_${crypto.randomUUID()}`
}

function campaignId(): string {
  return `cmp_${crypto.randomUUID()}`
}

function nowIso(): string {
  return new Date().toISOString()
}

/**
 * Records a subscription. Idempotent per normalized email: a repeat signup
 * refreshes `consentedAt`/`source` and reactivates the record (explicit
 * consent on the form overrides a prior opt-out). New subscribers start as
 * `"active"` — `"pending"` is reserved for a future double-opt-in flow.
 */
export function subscribe(email: string, source?: string): NewsletterSubscriber {
  const normalized = normalizeEmail(email)
  // Explicit consent on the form overrides a prior opt-out: clear any
  // "newsletter"-scope opt-out `unsubscribe` (or a token unsubscribe) recorded,
  // so send-time `isUnsubscribed` checks stay consistent with the record.
  resubscribeAddress(normalized, "newsletter")
  const existing = subscribers.get(normalized)
  const trimmedSource = source?.trim() ?? ""

  if (existing) {
    existing.consentedAt = nowIso()
    if (trimmedSource) existing.source = trimmedSource
    existing.status = "active"
    delete existing.unsubscribedAt
    return existing
  }

  // Bounded capacity: evict the oldest record (Map preserves insertion
  // order) so a flood of signups cannot grow memory without limit. Records
  // re-subscribed after eviction simply start fresh.
  if (subscribers.size >= NEWSLETTER_STORE_MAX_SUBSCRIBERS) {
    const oldest = subscribers.keys().next().value
    if (oldest !== undefined) subscribers.delete(oldest)
  }

  const subscriber: NewsletterSubscriber = {
    id: subscriberId(),
    email: normalized,
    source: trimmedSource,
    consentedAt: nowIso(),
    status: "active",
  }
  subscribers.set(normalized, subscriber)
  return subscriber
}

/**
 * Marks the subscriber for `email` as unsubscribed and records a
 * `"newsletter"`-scope opt-out in the `email-unsubscribe` store so send-time
 * checks stay consistent. Returns the updated record, or null when the
 * address was never subscribed.
 */
export function unsubscribe(email: string): NewsletterSubscriber | null {
  const normalized = normalizeEmail(email)
  const subscriber = subscribers.get(normalized)
  if (!subscriber) return null

  subscriber.status = "unsubscribed"
  subscriber.unsubscribedAt = nowIso()
  unsubscribeAddress(normalized, "newsletter")
  return subscriber
}

function matchesQuery(subscriber: NewsletterSubscriber, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  return subscriber.email.includes(needle) || subscriber.source.toLowerCase().includes(needle)
}

/**
 * Returns subscribers newest-first, filtered by status and/or a
 * case-insensitive email/source substring. `limit`/`offset` paginate the
 * filtered set; `total` is the pre-pagination count.
 */
export function listSubscribers(filter: SubscriberListFilter = {}): SubscriberListResult {
  const query = filter.query ?? ""
  const matched = [...subscribers.values()]
    .filter(
      (subscriber) =>
        (!filter.status || subscriber.status === filter.status) && matchesQuery(subscriber, query),
    )
    .sort((a, b) => b.consentedAt.localeCompare(a.consentedAt) || b.id.localeCompare(a.id))

  const offset = Math.max(0, filter.offset ?? 0)
  const limit = filter.limit ?? matched.length
  return {
    items: matched.slice(offset, offset + limit),
    total: matched.length,
  }
}

/**
 * Stores a campaign draft (or, when a later task adds scheduling/sending, a
 * campaign in another status). Only a truncated `bodyPreview` is persisted —
 * the full body is the caller's concern. `recipientCount` is optional
 * metadata filled in when a send is recorded.
 */
export function recordCampaign(input: {
  subject: string
  body?: string
  status?: NewsletterCampaignStatus
  recipientCount?: number
}): NewsletterCampaign {
  const body = input.body?.trim()
  const campaign: NewsletterCampaign = {
    id: campaignId(),
    subject: input.subject.trim(),
    status: input.status ?? "draft",
    createdAt: nowIso(),
    ...(body ? { bodyPreview: body.slice(0, BODY_PREVIEW_LENGTH) } : {}),
    ...(typeof input.recipientCount === "number" ? { recipientCount: input.recipientCount } : {}),
  }

  if (campaigns.size >= NEWSLETTER_STORE_MAX_CAMPAIGNS) {
    const oldest = campaigns.keys().next().value
    if (oldest !== undefined) campaigns.delete(oldest)
  }
  campaigns.set(campaign.id, campaign)
  return campaign
}

/** Returns campaigns newest-first with offset pagination. */
export function listCampaigns(filter: CampaignListFilter = {}): CampaignListResult {
  const all = [...campaigns.values()].sort(
    (a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id),
  )
  const offset = Math.max(0, filter.offset ?? 0)
  const limit = filter.limit ?? all.length
  return { items: all.slice(offset, offset + limit), total: all.length }
}

/** Counts subscribers and campaigns by status for the admin dashboard. */
export function stats(): NewsletterStats {
  const subscriberCounts: NewsletterStats["subscribers"] = {
    total: subscribers.size,
    pending: 0,
    active: 0,
    unsubscribed: 0,
  }
  for (const subscriber of subscribers.values()) {
    subscriberCounts[subscriber.status] += 1
  }

  const campaignCounts: NewsletterStats["campaigns"] = {
    total: campaigns.size,
    draft: 0,
    scheduled: 0,
    sent: 0,
  }
  for (const campaign of campaigns.values()) {
    campaignCounts[campaign.status] += 1
  }

  return { subscribers: subscriberCounts, campaigns: campaignCounts }
}

/** Test hook: clears all subscribers, campaigns, and recorded opt-outs. */
export function clearNewsletterStore(): void {
  subscribers.clear()
  campaigns.clear()
  clearUnsubscribeStore()
}
