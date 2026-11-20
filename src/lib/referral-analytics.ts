import {
  getReferralProgramSettings,
  getReferralProgramStats,
  listAttributionsForAdmin,
  REFERRAL_ATTRIBUTIONS_STORE_MAX,
  type ReferralAttribution,
} from "@/lib/referral-program"
import { listFlags } from "@/lib/referral-fraud"

/**
 * Referral program analytics — program-level health, cohorts, economics.
 *
 * This is deliberately distinct from the fraud review queue
 * (`referral-fraud.ts` route/screen) and the tracking dashboard: it answers
 * "how is the program performing?" over the attribution store in
 * `referral-program.ts`, not "which records look suspicious?".
 *
 * Everything here is READ-ONLY: it imports store accessors only and never
 * mutates program state. All inputs come from the bounded in-memory dev
 * seam (at most {@link REFERRAL_ATTRIBUTIONS_STORE_MAX} attributions), so
 * every computation is a bounded linear scan — `collectAttributions` pages
 * through `listAttributionsForAdmin` in 500-row chunks with a hard page cap.
 *
 * If a rewards ledger (`referral-rewards.ts`, task 89) or tracking store
 * (`referral-tracking.ts`, task 88) lands later, this module remains valid:
 * economics here are *estimates* derived from attribution statuses and
 * `settings.rewardAmountCents`, never ledger truth.
 *
 * Server-only in practice: imported by the admin route and tests; client
 * components must not import it (they mirror the response types instead).
 */

/* ------------------------------------------------------------------ */
/* Bounds & constants                                                   */
/* ------------------------------------------------------------------ */

/** Default leaderboard size; hard cap via {@link clampLeaderboardLimit}. */
export const REFERRAL_LEADERBOARD_DEFAULT_LIMIT = 10
export const REFERRAL_LEADERBOARD_MAX_LIMIT = 50

/** Default cohort window kept (most recent N cohorts). */
export const REFERRAL_COHORT_DEFAULT_LIMIT = 24
export const REFERRAL_COHORT_MAX_LIMIT = 104 // ~2 years of weekly cohorts

/** `listAttributionsForAdmin` page size used while draining the store. */
const ATTRIBUTION_PAGE_SIZE = 500
/** Hard cap on pagination loops — store max / page size + slack. */
const MAX_ATTRIBUTION_PAGES = Math.ceil(REFERRAL_ATTRIBUTIONS_STORE_MAX / ATTRIBUTION_PAGE_SIZE) + 2

/**
 * Health score returned when the store has no attributions in scope.
 * 50 is a deliberate neutral midpoint: an empty program is neither healthy
 * nor broken, and a neutral score avoids dashboards flashing red/green on
 * first deploy.
 */
export const REFERRAL_HEALTH_NEUTRAL_SCORE = 50

/**
 * Health score weights — must sum to 1. See {@link computeHealthScore} for
 * the exact formula.
 */
export const REFERRAL_HEALTH_WEIGHTS = {
  /** Share of attributions bound to a referred user (click → signup). */
  activation: 0.2,
  /** Share of *decided* attributions that qualified. */
  qualification: 0.3,
  /** Share of qualified attributions that reached "rewarded". */
  reward: 0.2,
  /** Inverse fraud rate — share of attributions NOT fraud-flagged. */
  fraud: 0.3,
} as const

export type ReferralCohortGranularity = "week" | "month"

export interface ReferralAnalyticsOptions {
  /**
   * Only include attributions created within the last `periodDays` days.
   * `null`/`undefined` includes everything in the store.
   */
  periodDays?: number | null
  /** Cohort bucket size. Defaults to `"month"`. */
  cohortGranularity?: ReferralCohortGranularity
  /** Leaderboard size, clamped to 1–{@link REFERRAL_LEADERBOARD_MAX_LIMIT}. */
  leaderboardLimit?: number
  /** Max cohorts returned (most recent kept), clamped to 1–104. */
  cohortLimit?: number
  /** "Now" for period filtering; injectable for tests. */
  now?: Date
}

/* ------------------------------------------------------------------ */
/* Internal helpers                                                     */
/* ------------------------------------------------------------------ */

function clampInt(value: number | undefined, min: number, max: number, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback
  return Math.min(Math.max(Math.trunc(value), min), max)
}

function isBound(attribution: ReferralAttribution): boolean {
  return attribution.referredUserId !== null && attribution.referredUserId.trim() !== ""
}

/**
 * Drains the attribution store through the admin listing API. The listing
 * is newest-first, so when a `periodDays` cutoff is set we can stop paging
 * as soon as we page past the cutoff — older records cannot re-enter scope.
 */
function collectAttributions(periodDays: number | null, now: Date): ReferralAttribution[] {
  const cutoffMs = periodDays === null ? null : now.getTime() - periodDays * 24 * 60 * 60 * 1000
  const items: ReferralAttribution[] = []
  let offset = 0
  let total = Number.POSITIVE_INFINITY

  for (let page = 0; page < MAX_ATTRIBUTION_PAGES && offset < total; page += 1) {
    const result = listAttributionsForAdmin({
      limit: ATTRIBUTION_PAGE_SIZE,
      offset,
    })
    total = result.total
    if (result.items.length === 0) break
    let pastCutoff = false
    for (const attribution of result.items) {
      if (cutoffMs !== null) {
        const created = Date.parse(attribution.createdAt)
        if (Number.isFinite(created) && created < cutoffMs) {
          pastCutoff = true
          break
        }
      }
      items.push(attribution)
    }
    offset += result.items.length
    if (pastCutoff) break
  }
  return items
}

/* ------------------------------------------------------------------ */
/* Totals                                                               */
/* ------------------------------------------------------------------ */

export interface ReferralAnalyticsTotals {
  /** Attributions inside the requested period (0 when store is empty). */
  attributions: number
  /** Attributions bound to a referred user (`referredUserId` set). */
  bound: number
  pending: number
  qualified: number
  rewarded: number
  rejected: number
  fraudFlagged: number
  /** Live referral-code records program-wide (not period-scoped). */
  codes: number
}

function emptyTotals(codes: number): ReferralAnalyticsTotals {
  return {
    attributions: 0,
    bound: 0,
    pending: 0,
    qualified: 0,
    rewarded: 0,
    rejected: 0,
    fraudFlagged: 0,
    codes,
  }
}

function computeTotals(
  attributions: ReferralAttribution[],
  codes: number,
): ReferralAnalyticsTotals {
  const totals = emptyTotals(codes)
  for (const attribution of attributions) {
    totals.attributions += 1
    if (isBound(attribution)) totals.bound += 1
    totals[attribution.status] += 1
    if (attribution.fraudFlagged) totals.fraudFlagged += 1
  }
  return totals
}

/* ------------------------------------------------------------------ */
/* Health score                                                         */
/* ------------------------------------------------------------------ */

export interface ReferralHealthComponents {
  /** % of attributions bound to a referred user (0–100, null when empty). */
  activation: number | null
  /** % of decided attributions that qualified (0–100, null when none decided). */
  qualification: number | null
  /** % of qualified attributions that were rewarded (0–100, null when none qualified). */
  reward: number | null
  /** % of attributions NOT fraud-flagged (0–100, null when empty). */
  fraudFree: number | null
}

export interface ReferralHealthScore {
  /**
   * Composite 0–100. When the store has no attributions in scope the score
   * is {@link REFERRAL_HEALTH_NEUTRAL_SCORE} (50) and every component is
   * null — documented neutral value, not a real measurement.
   *
   * Formula (each component is a percentage 0–100):
   *   activation    = bound / attributions
   *   qualification = (qualified + rewarded) / decided
   *                   where decided = qualified + rewarded + rejected
   *   reward        = rewarded / (qualified + rewarded)
   *   fraudFree     = 1 − fraudFlagged / attributions
   *   score = round(100 × (0.2·activation + 0.3·qualification
   *                        + 0.2·reward + 0.3·fraudFree))
   * Components that are null (no denominator) contribute 0 to the sum —
   * a store with data but no conversions therefore scores at or below
   * neutral, which is intentional.
   */
  score: number
  hasData: boolean
  components: ReferralHealthComponents
  weights: typeof REFERRAL_HEALTH_WEIGHTS
}

function pct(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null
  return Math.round((numerator / denominator) * 1000) / 10 // one decimal
}

export function computeHealthScore(totals: ReferralAnalyticsTotals): ReferralHealthScore {
  const components: ReferralHealthComponents = {
    activation: pct(totals.bound, totals.attributions),
    qualification: pct(
      totals.qualified + totals.rewarded,
      totals.qualified + totals.rewarded + totals.rejected,
    ),
    reward: pct(totals.rewarded, totals.qualified + totals.rewarded),
    fraudFree: pct(totals.attributions - totals.fraudFlagged, totals.attributions),
  }

  if (totals.attributions === 0) {
    return {
      score: REFERRAL_HEALTH_NEUTRAL_SCORE,
      hasData: false,
      components: { activation: null, qualification: null, reward: null, fraudFree: null },
      weights: REFERRAL_HEALTH_WEIGHTS,
    }
  }

  const weighted =
    REFERRAL_HEALTH_WEIGHTS.activation * (components.activation ?? 0) +
    REFERRAL_HEALTH_WEIGHTS.qualification * (components.qualification ?? 0) +
    REFERRAL_HEALTH_WEIGHTS.reward * (components.reward ?? 0) +
    REFERRAL_HEALTH_WEIGHTS.fraud * (components.fraudFree ?? 0)

  return {
    score: Math.min(100, Math.max(0, Math.round(weighted))),
    hasData: true,
    components,
    weights: REFERRAL_HEALTH_WEIGHTS,
  }
}

/* ------------------------------------------------------------------ */
/* Cohorts                                                              */
/* ------------------------------------------------------------------ */

export interface ReferralCohort {
  /** `"YYYY-MM"` for month granularity, `"YYYY-Www"` (ISO week) for week. */
  key: string
  /** ISO timestamp of the cohort bucket start (UTC). */
  start: string
  total: number
  bound: number
  pending: number
  qualified: number
  rewarded: number
  rejected: number
  fraudFlagged: number
  /** (qualified + rewarded) / decided — null when nothing decided. */
  qualificationRate: number | null
  /** rewarded / (qualified + rewarded) — null when nothing qualified. */
  rewardRate: number | null
}

/** ISO-8601 week number (weeks start Monday, week 1 contains Jan 4). */
function isoWeekKey(date: Date): { key: string; start: Date } {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  const day = d.getUTCDay() || 7 // Mon=1..Sun=7
  d.setUTCDate(d.getUTCDate() - (day - 1)) // Monday of this week
  const thursday = new Date(d)
  thursday.setUTCDate(d.getUTCDate() + 3)
  const year = thursday.getUTCFullYear()
  const jan4 = new Date(Date.UTC(year, 0, 4))
  const jan4Day = jan4.getUTCDay() || 7
  const week1Monday = new Date(jan4)
  week1Monday.setUTCDate(jan4.getUTCDate() - (jan4Day - 1))
  const week = Math.round((d.getTime() - week1Monday.getTime()) / (7 * 24 * 60 * 60 * 1000)) + 1
  return {
    key: `${year}-W${String(week).padStart(2, "0")}`,
    start: d,
  }
}

function monthKey(date: Date): { key: string; start: Date } {
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1))
  return {
    key: `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`,
    start,
  }
}

/**
 * Groups attributions into signup cohorts by `createdAt`. Cohorts are
 * returned oldest→newest, capped to the most recent `cohortLimit` buckets
 * (bounds output size regardless of store age spread).
 */
export function computeCohorts(
  attributions: readonly ReferralAttribution[],
  granularity: ReferralCohortGranularity,
  cohortLimit: number,
): ReferralCohort[] {
  const buckets = new Map<string, { start: Date; items: ReferralAttribution[] }>()
  for (const attribution of attributions) {
    const created = Date.parse(attribution.createdAt)
    if (!Number.isFinite(created)) continue
    const { key, start } =
      granularity === "week" ? isoWeekKey(new Date(created)) : monthKey(new Date(created))
    let bucket = buckets.get(key)
    if (!bucket) {
      bucket = { start, items: [] }
      buckets.set(key, bucket)
    }
    bucket.items.push(attribution)
  }

  const cohorts = [...buckets.entries()]
    .map(([key, bucket]) => {
      const totals = computeTotals(bucket.items, 0)
      return {
        key,
        start: bucket.start.toISOString(),
        total: totals.attributions,
        bound: totals.bound,
        pending: totals.pending,
        qualified: totals.qualified,
        rewarded: totals.rewarded,
        rejected: totals.rejected,
        fraudFlagged: totals.fraudFlagged,
        qualificationRate: pct(
          totals.qualified + totals.rewarded,
          totals.qualified + totals.rewarded + totals.rejected,
        ),
        rewardRate: pct(totals.rewarded, totals.qualified + totals.rewarded),
      } satisfies ReferralCohort
    })
    .sort((a, b) => a.start.localeCompare(b.start) || a.key.localeCompare(b.key))

  return cohorts.slice(-Math.max(cohortLimit, 1))
}

/* ------------------------------------------------------------------ */
/* Leaderboard                                                         */
/* ------------------------------------------------------------------ */

export interface ReferralLeaderboardEntry {
  referrerUserId: string
  /** Most recently used referral code for this referrer, when known. */
  code: string | null
  clicks: number
  bound: number
  pending: number
  qualified: number
  rewarded: number
  rejected: number
  fraudFlagged: number
  /** (qualified + rewarded) / clicks — null when no clicks. */
  conversionRate: number | null
}

/**
 * Top referrers ranked by qualified+rewarded volume (rewarded breaks ties,
 * then total clicks, then userId for determinism). Bounded to
 * `leaderboardLimit` entries.
 */
export function computeLeaderboard(
  attributions: readonly ReferralAttribution[],
  leaderboardLimit: number,
): ReferralLeaderboardEntry[] {
  const byReferrer = new Map<string, ReferralLeaderboardEntry>()
  for (const attribution of attributions) {
    let entry = byReferrer.get(attribution.referrerUserId)
    if (!entry) {
      entry = {
        referrerUserId: attribution.referrerUserId,
        code: null,
        clicks: 0,
        bound: 0,
        pending: 0,
        qualified: 0,
        rewarded: 0,
        rejected: 0,
        fraudFlagged: 0,
        conversionRate: null,
      }
      byReferrer.set(attribution.referrerUserId, entry)
    }
    entry.clicks += 1
    if (isBound(attribution)) entry.bound += 1
    entry[attribution.status] += 1
    if (attribution.fraudFlagged) entry.fraudFlagged += 1
    // Attributions arrive newest-first; first code seen is the latest used.
    if (entry.code === null) entry.code = attribution.code
  }

  return [...byReferrer.values()]
    .map((entry) => ({
      ...entry,
      conversionRate: pct(entry.qualified + entry.rewarded, entry.clicks),
    }))
    .sort(
      (a, b) =>
        b.qualified + b.rewarded - (a.qualified + a.rewarded) ||
        b.rewarded - a.rewarded ||
        b.clicks - a.clicks ||
        a.referrerUserId.localeCompare(b.referrerUserId),
    )
    .slice(0, Math.max(leaderboardLimit, 1))
}

/* ------------------------------------------------------------------ */
/* Economics & fraud exposure                                          */
/* ------------------------------------------------------------------ */

export interface ReferralRewardEconomics {
  /** Label from settings — reporting copy only, no payout pipeline. */
  rewardLabel: string
  /** Per-reward value in cents; `null` means "no monetary value set". */
  rewardAmountCents: number | null
  pending: number
  qualified: number
  rewarded: number
  rejected: number
  /**
   * Estimated outstanding liability in cents:
   * `(pending + qualified) × rewardAmountCents`. Pending and qualified
   * attributions may still convert to rewards, so they are the exposure.
   * `null` when `rewardAmountCents` is null (program has no monetary value).
   */
  estimatedLiabilityCents: number | null
  /**
   * Already-granted estimate: `rewarded × rewardAmountCents`. Reporting
   * only — rewards are conceptual marks, not money movement.
   */
  grantedCents: number | null
}

export function computeEconomics(totals: ReferralAnalyticsTotals): ReferralRewardEconomics {
  const { rewardLabel, rewardAmountCents } = getReferralProgramSettings()
  const outstanding = totals.pending + totals.qualified
  return {
    rewardLabel,
    rewardAmountCents,
    pending: totals.pending,
    qualified: totals.qualified,
    rewarded: totals.rewarded,
    rejected: totals.rejected,
    estimatedLiabilityCents: rewardAmountCents === null ? null : outstanding * rewardAmountCents,
    grantedCents: rewardAmountCents === null ? null : totals.rewarded * rewardAmountCents,
  }
}

export interface ReferralFraudExposure {
  /** Attributions the fraud seam has marked (`fraudFlagged`). */
  flaggedTotal: number
  /** flaggedTotal / attributions — null when empty. */
  flaggedRate: number | null
  flaggedPending: number
  flaggedQualified: number
  flaggedRewarded: number
  flaggedRejected: number
  /**
   * Flagged attributions that already reached "rewarded" — rewards granted
   * despite the fraud mark. `× rewardAmountCents` exposure when a monetary
   * reward is configured, else null.
   */
  flaggedRewardedCount: number
  flaggedRewardedCents: number | null
  /**
   * Summary of the separate `referral-fraud.ts` review-queue store (rule
   * engine flags, a different population from attribution `fraudFlagged`).
   */
  reviewQueue: {
    pending: number
    cleared: number
    confirmedFraud: number
    total: number
  }
}

export function computeFraudExposure(
  attributions: readonly ReferralAttribution[],
  totals: ReferralAnalyticsTotals,
): ReferralFraudExposure {
  let flaggedPending = 0
  let flaggedQualified = 0
  let flaggedRewarded = 0
  let flaggedRejected = 0
  for (const attribution of attributions) {
    if (!attribution.fraudFlagged) continue
    if (attribution.status === "pending") flaggedPending += 1
    else if (attribution.status === "qualified") flaggedQualified += 1
    else if (attribution.status === "rewarded") flaggedRewarded += 1
    else flaggedRejected += 1
  }

  const { rewardAmountCents } = getReferralProgramSettings()
  const queue = {
    pending: listFlags({ status: "pending", limit: 1 }).total,
    cleared: listFlags({ status: "cleared", limit: 1 }).total,
    confirmedFraud: listFlags({ status: "confirmed_fraud", limit: 1 }).total,
    total: listFlags({ limit: 1 }).total,
  }

  return {
    flaggedTotal: totals.fraudFlagged,
    flaggedRate: pct(totals.fraudFlagged, totals.attributions),
    flaggedPending,
    flaggedQualified,
    flaggedRewarded,
    flaggedRejected,
    flaggedRewardedCount: flaggedRewarded,
    flaggedRewardedCents: rewardAmountCents === null ? null : flaggedRewarded * rewardAmountCents,
    reviewQueue: queue,
  }
}

/* ------------------------------------------------------------------ */
/* Report                                                               */
/* ------------------------------------------------------------------ */

export interface ReferralAnalyticsReport {
  generatedAt: string
  /** Resolved period actually applied (null = all stored attributions). */
  period: { days: number | null; from: string | null }
  settings: {
    enabled: boolean
    rewardLabel: string
    rewardAmountCents: number | null
    maxRewardsPerUser: number
    windowDays: number
  }
  totals: ReferralAnalyticsTotals
  health: ReferralHealthScore
  cohorts: ReferralCohort[]
  leaderboard: ReferralLeaderboardEntry[]
  economics: ReferralRewardEconomics
  fraud: ReferralFraudExposure
}

/**
 * Full program-analytics payload. Pure read: drains the bounded
 * attribution store once, then derives every section from that snapshot.
 */
export function getReferralAnalytics(
  options: ReferralAnalyticsOptions = {},
): ReferralAnalyticsReport {
  const now = options.now ?? new Date()
  const periodDays =
    options.periodDays === undefined || options.periodDays === null
      ? null
      : clampInt(options.periodDays, 1, 3650, 0) || null
  const granularity: ReferralCohortGranularity =
    options.cohortGranularity === "week" ? "week" : "month"
  const leaderboardLimit = clampInt(
    options.leaderboardLimit,
    1,
    REFERRAL_LEADERBOARD_MAX_LIMIT,
    REFERRAL_LEADERBOARD_DEFAULT_LIMIT,
  )
  const cohortLimit = clampInt(
    options.cohortLimit,
    1,
    REFERRAL_COHORT_MAX_LIMIT,
    REFERRAL_COHORT_DEFAULT_LIMIT,
  )

  const settings = getReferralProgramSettings()
  const attributions = collectAttributions(periodDays, now)
  const totals = computeTotals(attributions, getReferralProgramStats().totals.codes)

  return {
    generatedAt: now.toISOString(),
    period: {
      days: periodDays,
      from:
        periodDays === null
          ? null
          : new Date(now.getTime() - periodDays * 24 * 60 * 60 * 1000).toISOString(),
    },
    settings: {
      enabled: settings.enabled,
      rewardLabel: settings.rewardLabel,
      rewardAmountCents: settings.rewardAmountCents,
      maxRewardsPerUser: settings.maxRewardsPerUser,
      windowDays: settings.windowDays,
    },
    totals,
    health: computeHealthScore(totals),
    cohorts: computeCohorts(attributions, granularity, cohortLimit),
    leaderboard: computeLeaderboard(attributions, leaderboardLimit),
    economics: computeEconomics(totals),
    fraud: computeFraudExposure(attributions, totals),
  }
}
