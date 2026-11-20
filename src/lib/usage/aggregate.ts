/**
 * Pure aggregation over `FeatureUsageEvent` streams.
 *
 * All functions are side-effect free: they take an array of events (already
 * parsed via `parseFeatureUsageEvent`/`parseFeatureUsageEventLine` or built
 * via `createFeatureUsageEvent`) and return plain data. The report script
 * (`scripts/analytics/usage/report.mjs`) mirrors these calculations for
 * JSONL input; keep the two implementations in sync — `usage.test.ts` pins
 * the semantics.
 */

import type { FeatureUsageEvent } from "./events"

export interface FeatureUsageCount {
  feature: string
  /** Total usage events for the feature. */
  events: number
  /** Distinct subjects that used the feature. */
  uniqueSubjects: number
}

export interface FeatureAdoption extends FeatureUsageCount {
  /**
   * Share of the subject universe that used the feature, 0–1.
   * Denominator is `totalSubjects` when provided, otherwise the number of
   * distinct subjects across the whole event set.
   */
  adoption: number
}

export interface FeatureDailyActiveUsers {
  /** UTC calendar day, `YYYY-MM-DD`. */
  date: string
  feature: string
  /** Distinct subjects using the feature on that day (DAU-per-feature). */
  activeSubjects: number
  /** Total events for the feature on that day. */
  events: number
}

export interface UsageTotals {
  events: number
  uniqueSubjects: number
  features: number
}

export interface UsageSummary {
  totals: UsageTotals
  /** Per-feature counts, sorted by unique subjects desc then events desc. */
  byFeature: FeatureUsageCount[]
  /** Per-feature adoption rates, same ordering. */
  adoption: FeatureAdoption[]
  /** DAU-per-feature per UTC day, sorted by date then feature. */
  dailyActiveUsers: FeatureDailyActiveUsers[]
}

const DAY_MS = 24 * 60 * 60 * 1000

function utcDayKey(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10)
}

function compareCounts(a: FeatureUsageCount, b: FeatureUsageCount): number {
  return (
    b.uniqueSubjects - a.uniqueSubjects || b.events - a.events || a.feature.localeCompare(b.feature)
  )
}

/**
 * Counts events and distinct subjects per feature.
 * Events with invalid timestamps still count toward `events` but are
 * excluded from day bucketing (NaN-safe: `utcDayKey` returns "Invalid Date"
 * slices — callers should pre-validate, which `parseFeatureUsageEvent` does).
 */
export function countFeatureUsage(events: readonly FeatureUsageEvent[]): FeatureUsageCount[] {
  const byFeature = new Map<string, { events: number; subjects: Set<string> }>()

  for (const event of events) {
    let entry = byFeature.get(event.feature)
    if (!entry) {
      entry = { events: 0, subjects: new Set() }
      byFeature.set(event.feature, entry)
    }
    entry.events += 1
    entry.subjects.add(event.subject)
  }

  return [...byFeature.entries()]
    .map(([feature, entry]) => ({
      feature,
      events: entry.events,
      uniqueSubjects: entry.subjects.size,
    }))
    .sort(compareCounts)
}

function distinctSubjects(events: readonly FeatureUsageEvent[]): Set<string> {
  const subjects = new Set<string>()
  for (const event of events) subjects.add(event.subject)
  return subjects
}

/**
 * Adoption rate per feature: unique subjects using the feature divided by
 * the subject universe.
 *
 * `totalSubjects` is the denominator (e.g. all signed-up users, or all
 * subjects seen in a wider window). When omitted, the denominator is the
 * distinct subjects present in `events` itself — i.e. adoption among active
 * subjects. Returns [] for an empty denominator universe.
 */
export function computeAdoptionRates(
  events: readonly FeatureUsageEvent[],
  totalSubjects?: number,
): FeatureAdoption[] {
  const denominator =
    totalSubjects !== undefined ? Math.max(0, totalSubjects) : distinctSubjects(events).size

  return countFeatureUsage(events).map((count) => ({
    ...count,
    adoption: denominator > 0 ? count.uniqueSubjects / denominator : 0,
  }))
}

/**
 * DAU per feature: for each UTC calendar day, the number of distinct
 * subjects that used each feature, plus the raw event count. Sorted by date
 * then feature name. This is the per-feature analogue of classic DAU.
 */
export function computeDailyActiveUsers(
  events: readonly FeatureUsageEvent[],
): FeatureDailyActiveUsers[] {
  const byDayFeature = new Map<
    string,
    { date: string; feature: string; subjects: Set<string>; events: number }
  >()

  for (const event of events) {
    const date = utcDayKey(event.timestamp)
    const key = JSON.stringify([date, event.feature])
    let entry = byDayFeature.get(key)
    if (!entry) {
      entry = { date, feature: event.feature, subjects: new Set(), events: 0 }
      byDayFeature.set(key, entry)
    }
    entry.events += 1
    entry.subjects.add(event.subject)
  }

  return [...byDayFeature.values()]
    .map((entry) => ({
      date: entry.date,
      feature: entry.feature,
      activeSubjects: entry.subjects.size,
      events: entry.events,
    }))
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        b.activeSubjects - a.activeSubjects ||
        a.feature.localeCompare(b.feature),
    )
}

/**
 * Overall totals across the event set.
 */
export function computeUsageTotals(events: readonly FeatureUsageEvent[]): UsageTotals {
  return {
    events: events.length,
    uniqueSubjects: distinctSubjects(events).size,
    features: new Set(events.map((e) => e.feature)).size,
  }
}

/**
 * Full usage summary: totals, per-feature counts and adoption, and
 * DAU-per-feature. `totalSubjects` is forwarded to `computeAdoptionRates`.
 */
export function summarizeUsage(
  events: readonly FeatureUsageEvent[],
  options: { totalSubjects?: number } = {},
): UsageSummary {
  return {
    totals: computeUsageTotals(events),
    byFeature: countFeatureUsage(events),
    adoption: computeAdoptionRates(events, options.totalSubjects),
    dailyActiveUsers: computeDailyActiveUsers(events),
  }
}

/**
 * Restricts events to a UTC-day window `[start, end)` where both bounds are
 * epoch ms. Used by callers that need a trailing-N-days view; pure and
 * allocation-light.
 */
export function filterEventsByWindow(
  events: readonly FeatureUsageEvent[],
  start: number,
  end: number,
): FeatureUsageEvent[] {
  return events.filter((event) => event.timestamp >= start && event.timestamp < end)
}

/** Epoch ms for the start of the UTC day `daysAgo` days before `now`. */
export function utcDayStart(now: number, daysAgo = 0): number {
  const d = new Date(now)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - daysAgo * DAY_MS
}
