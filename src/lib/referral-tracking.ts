import {
  listAttributionsForAdmin,
  REFERRAL_ATTRIBUTIONS_STORE_MAX,
  REFERRAL_ATTRIBUTION_SOURCES,
  REFERRAL_ATTRIBUTION_STATUSES,
  type ReferralAttribution,
  type ReferralAttributionSource,
  type ReferralAttributionStatus,
} from "@/lib/referral-program"

/**
 * Referral tracking analytics: a pure aggregation layer over the
 * attribution records exposed by `src/lib/referral-program.ts`.
 *
 * Every exported function takes a plain array of attributions (the shape
 * returned by {@link collectAllAttributions} / `listAttributionsForAdmin`)
 * and returns derived counts — no store access inside the pure functions,
 * no I/O. The `/api/admin/referral-tracking` route collects the bounded
 * store server-side and aggregates here.
 *
 * DATA CAVEAT: the underlying store is in-memory, per-instance, bounded at
 * {@link REFERRAL_ATTRIBUTIONS_STORE_MAX} records (oldest evicted first),
 * and lost on restart — these metrics cover only retained records, not
 * durable history. There is no state in this module; nothing to reset.
 */

export const REFERRAL_TRACKING_MAX_DAYS = 90
export const REFERRAL_TRACKING_DEFAULT_DAYS = 30
export const REFERRAL_TRACKING_TOP_REFERRERS_MAX = 50
export const REFERRAL_TRACKING_TOP_REFERRERS_DEFAULT = 10

const DAY_MS = 24 * 60 * 60 * 1000

/** Minimal record shape the aggregations need (subset of ReferralAttribution). */
export type ReferralTrackingRecord = Pick<
  ReferralAttribution,
  "code" | "referrerUserId" | "status" | "source" | "createdAt" | "fraudFlagged"
>

/* ------------------------------------------------------------------ */
/* Funnel                                                              */
/* ------------------------------------------------------------------ */

/**
 * Funnel stage counts. `clicks` is the total record count — every record
 * began as a click/signup/manual event and currently sits in exactly one
 * status, so `pending + qualified + rewarded + rejected === clicks`.
 */
export interface ReferralFunnelCounts {
  clicks: number
  pending: number
  qualified: number
  rewarded: number
  rejected: number
  fraudFlagged: number
}

/**
 * Conversion rates as fractions of `clicks` (0–1, 4-decimal rounding).
 * All are 0 when the store is empty.
 *
 *  - `pending` / `qualified` / `rewarded` / `rejected`: share of all clicks
 *    currently sitting in that status.
 *  - `qualifiedOrRewarded`: share of clicks that reached at least
 *    `qualified` (qualified + rewarded) — the program's "conversion" rate.
 *  - `rewardedOfQualified`: of records that ever qualified (qualified +
 *    rewarded), the share that was rewarded — the payout completion rate.
 */
export interface ReferralFunnelRates {
  pending: number
  qualified: number
  rewarded: number
  rejected: number
  qualifiedOrRewarded: number
  rewardedOfQualified: number
}

export interface ReferralFunnel {
  counts: ReferralFunnelCounts
  rates: ReferralFunnelRates
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000
}

function emptyCounts(): ReferralFunnelCounts {
  return { clicks: 0, pending: 0, qualified: 0, rewarded: 0, rejected: 0, fraudFlagged: 0 }
}

/**
 * Status funnel over the given attributions: per-status counts plus
 * conversion rates. An empty input yields all-zero counts and rates.
 */
export function funnelCounts(attributions: readonly ReferralTrackingRecord[]): ReferralFunnel {
  const counts = emptyCounts()
  for (const attribution of attributions) {
    counts.clicks += 1
    counts[attribution.status] += 1
    if (attribution.fraudFlagged) counts.fraudFlagged += 1
  }

  const total = counts.clicks
  const everQualified = counts.qualified + counts.rewarded
  const rates: ReferralFunnelRates = {
    pending: total === 0 ? 0 : round4(counts.pending / total),
    qualified: total === 0 ? 0 : round4(counts.qualified / total),
    rewarded: total === 0 ? 0 : round4(counts.rewarded / total),
    rejected: total === 0 ? 0 : round4(counts.rejected / total),
    qualifiedOrRewarded: total === 0 ? 0 : round4(everQualified / total),
    rewardedOfQualified: everQualified === 0 ? 0 : round4(counts.rewarded / everQualified),
  }
  return { counts, rates }
}

/* ------------------------------------------------------------------ */
/* Breakdowns                                                          */
/* ------------------------------------------------------------------ */

/** Per-key status counts shared by code/source/referrer breakdowns. */
export interface ReferralBreakdownCounts {
  total: number
  pending: number
  qualified: number
  rewarded: number
  rejected: number
  fraudFlagged: number
}

export interface ReferralCodeBreakdownEntry extends ReferralBreakdownCounts {
  code: string
}

export interface ReferralSourceBreakdownEntry extends ReferralBreakdownCounts {
  source: ReferralAttributionSource
}

export interface ReferralReferrerBreakdownEntry extends ReferralBreakdownCounts {
  referrerUserId: string
}

function tally(
  attributions: readonly ReferralTrackingRecord[],
  key: (a: ReferralTrackingRecord) => string,
): Map<string, ReferralBreakdownCounts> {
  const map = new Map<string, ReferralBreakdownCounts>()
  for (const attribution of attributions) {
    const k = key(attribution)
    let entry = map.get(k)
    if (!entry) {
      entry = { total: 0, pending: 0, qualified: 0, rewarded: 0, rejected: 0, fraudFlagged: 0 }
      map.set(k, entry)
    }
    entry.total += 1
    entry[attribution.status] += 1
    if (attribution.fraudFlagged) entry.fraudFlagged += 1
  }
  return map
}

/**
 * Per-referral-code breakdown, sorted by `rewarded` desc then `total` desc
 * then code asc. Only codes present in the input appear.
 */
export function breakdownByCode(
  attributions: readonly ReferralTrackingRecord[],
): ReferralCodeBreakdownEntry[] {
  return [...tally(attributions, (a) => a.code).entries()]
    .map(([code, counts]) => ({ code, ...counts }))
    .sort((a, b) => b.rewarded - a.rewarded || b.total - a.total || a.code.localeCompare(b.code))
}

/**
 * Per-source breakdown (`click` / `signup` / `manual`), sorted by `total`
 * desc then source asc.
 */
export function breakdownBySource(
  attributions: readonly ReferralTrackingRecord[],
): ReferralSourceBreakdownEntry[] {
  return [...tally(attributions, (a) => a.source).entries()]
    .map(([source, counts]) => ({
      source: source as ReferralAttributionSource,
      ...counts,
    }))
    .sort((a, b) => b.total - a.total || a.source.localeCompare(b.source))
}

/**
 * Top referrers by reward output: sorted by `rewarded` desc, then `total`
 * desc, then user id asc; truncated to `limit` (clamped 1–
 * {@link REFERRAL_TRACKING_TOP_REFERRERS_MAX}, default
 * {@link REFERRAL_TRACKING_TOP_REFERRERS_DEFAULT}).
 */
export function topReferrers(
  attributions: readonly ReferralTrackingRecord[],
  limit: number = REFERRAL_TRACKING_TOP_REFERRERS_DEFAULT,
): ReferralReferrerBreakdownEntry[] {
  const max = Math.min(REFERRAL_TRACKING_TOP_REFERRERS_MAX, Math.max(1, Math.floor(limit)))
  return [...tally(attributions, (a) => a.referrerUserId).entries()]
    .map(([referrerUserId, counts]) => ({ referrerUserId, ...counts }))
    .sort(
      (a, b) =>
        b.rewarded - a.rewarded ||
        b.total - a.total ||
        a.referrerUserId.localeCompare(b.referrerUserId),
    )
    .slice(0, max)
}

/* ------------------------------------------------------------------ */
/* Daily series                                                        */
/* ------------------------------------------------------------------ */

export interface ReferralDailyPoint {
  /** UTC calendar day, `YYYY-MM-DD`. */
  date: string
  /** Records created that day, by current status. */
  clicks: number
  pending: number
  qualified: number
  rewarded: number
  rejected: number
  fraudFlagged: number
}

function clampDays(days: number): number {
  if (!Number.isFinite(days)) return REFERRAL_TRACKING_DEFAULT_DAYS
  return Math.min(REFERRAL_TRACKING_MAX_DAYS, Math.max(1, Math.floor(days)))
}

function utcDayKey(iso: string): string | null {
  const time = Date.parse(iso)
  if (Number.isNaN(time)) return null
  return new Date(time).toISOString().slice(0, 10)
}

/**
 * Daily attribution volume for the last `days` UTC calendar days ending
 * today (`now` injectable for tests), zero-filled so charts render a
 * continuous axis. `days` is clamped to 1–{@link
 * REFERRAL_TRACKING_MAX_DAYS}. Each point buckets records by `createdAt`
 * day and reports their *current* status — a record created Monday and
 * rewarded Wednesday counts under Monday. Records with unparseable
 * `createdAt` or outside the window are ignored.
 */
export function dailySeries(
  attributions: readonly ReferralTrackingRecord[],
  days: number = REFERRAL_TRACKING_DEFAULT_DAYS,
  now: number = Date.now(),
): ReferralDailyPoint[] {
  const windowDays = clampDays(days)
  const todayUtc = new Date(now)
  const startOfToday = Date.UTC(
    todayUtc.getUTCFullYear(),
    todayUtc.getUTCMonth(),
    todayUtc.getUTCDate(),
  )
  const windowStart = startOfToday - (windowDays - 1) * DAY_MS

  const series = new Map<string, ReferralDailyPoint>()
  for (let i = 0; i < windowDays; i += 1) {
    const date = new Date(windowStart + i * DAY_MS).toISOString().slice(0, 10)
    series.set(date, {
      date,
      clicks: 0,
      pending: 0,
      qualified: 0,
      rewarded: 0,
      rejected: 0,
      fraudFlagged: 0,
    })
  }

  for (const attribution of attributions) {
    const day = utcDayKey(attribution.createdAt)
    const point = day === null ? undefined : series.get(day)
    if (!point) continue
    point.clicks += 1
    point[attribution.status] += 1
    if (attribution.fraudFlagged) point.fraudFlagged += 1
  }

  return [...series.values()]
}

/* ------------------------------------------------------------------ */
/* Store collection (bounded)                                          */
/* ------------------------------------------------------------------ */

const COLLECT_PAGE_SIZE = 500

/**
 * Collects every attribution currently retained in the referral-program
 * store by paging through `listAttributionsForAdmin` (whose `limit` clamps
 * to 500). The store is capped at {@link REFERRAL_ATTRIBUTIONS_STORE_MAX},
 * so this is at most ~20 pages of a linear scan — bounded and cheap.
 *
 * Server-side only: this reads the live store; pure functions above accept
 * any array.
 */
export function collectAllAttributions(): ReferralAttribution[] {
  const items: ReferralAttribution[] = []
  let offset = 0
  // `total` is stable within a single request unless concurrent writes
  // evict records; loop on page emptiness as a safety net.
  for (;;) {
    const page = listAttributionsForAdmin({
      limit: COLLECT_PAGE_SIZE,
      offset,
    })
    items.push(...page.items)
    if (page.items.length < COLLECT_PAGE_SIZE) break
    offset += page.items.length
  }
  return items
}

/* ------------------------------------------------------------------ */
/* One-shot payload                                                    */
/* ------------------------------------------------------------------ */

export interface ReferralTrackingAnalytics {
  days: number
  /** ISO timestamp of when the aggregation ran. */
  generatedAt: string
  funnel: ReferralFunnel
  byCode: ReferralCodeBreakdownEntry[]
  bySource: ReferralSourceBreakdownEntry[]
  topReferrers: ReferralReferrerBreakdownEntry[]
  /** Daily counts by status for the last `days` UTC days, zero-filled. */
  daily: ReferralDailyPoint[]
  /** Status/source vocabulary echoed back for clients. */
  statuses: readonly ReferralAttributionStatus[]
  sources: readonly ReferralAttributionSource[]
}

/**
 * One-shot aggregation for the tracking endpoint. `days` is clamped to
 * 1–{@link REFERRAL_TRACKING_MAX_DAYS}; `now` is injectable for tests.
 */
export function buildReferralTracking(
  attributions: readonly ReferralTrackingRecord[],
  {
    days = REFERRAL_TRACKING_DEFAULT_DAYS,
    now = Date.now(),
    topReferrerLimit = REFERRAL_TRACKING_TOP_REFERRERS_DEFAULT,
  }: {
    days?: number
    now?: number
    topReferrerLimit?: number
  } = {},
): ReferralTrackingAnalytics {
  const windowDays = clampDays(days)
  return {
    days: windowDays,
    generatedAt: new Date(now).toISOString(),
    funnel: funnelCounts(attributions),
    byCode: breakdownByCode(attributions),
    bySource: breakdownBySource(attributions),
    topReferrers: topReferrers(attributions, topReferrerLimit),
    daily: dailySeries(attributions, windowDays, now),
    statuses: REFERRAL_ATTRIBUTION_STATUSES,
    sources: REFERRAL_ATTRIBUTION_SOURCES,
  }
}
