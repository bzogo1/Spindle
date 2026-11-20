import type { ContactSubmission } from "@/lib/contact-routing"

/**
 * Pure aggregation over the contact-submission store in
 * `src/lib/contact-routing.ts`.
 *
 * Every function takes a plain array of submissions (the shape returned by
 * `listSubmissions`) and returns derived counts — no store access, no I/O, no
 * Date.now() unless `now` is omitted. The `/api/admin/contact/analytics`
 * route fetches the bounded store (~500 records) and aggregates server-side;
 * because the store is in-memory, analytics cover only retained submissions
 * (see the store docstring for the eviction/restart caveats).
 */

export const CONTACT_ANALYTICS_MAX_DAYS = 90
export const CONTACT_ANALYTICS_DEFAULT_DAYS = 30

const DAY_MS = 24 * 60 * 60 * 1000

/** One row of a breakdown: a dimension key and how many submissions have it. */
export interface BreakdownEntry {
  key: string
  count: number
}

/** Share of `total` for a breakdown key, 0–100 rounded to one decimal. */
export interface QueueBreakdownEntry extends BreakdownEntry {
  percent: number
}

export interface ContactAnalyticsSummary {
  total: number
  byStatus: BreakdownEntry[]
  byQueue: BreakdownEntry[]
  byTopic: BreakdownEntry[]
}

export interface ContactDailyPoint {
  /** UTC calendar day, `YYYY-MM-DD`. */
  date: string
  count: number
}

export interface ContactAnalytics {
  days: number
  /** ISO timestamp of when the aggregation ran. */
  generatedAt: string
  summary: ContactAnalyticsSummary
  /** Per-queue counts with percent-of-total shares, sorted desc. */
  queueBreakdown: QueueBreakdownEntry[]
  /** Daily submission volume for the last `days` UTC days, zero-filled. */
  daily: ContactDailyPoint[]
}

type SubmissionLike = Pick<ContactSubmission, "status" | "routedTo" | "topic" | "createdAt">

function clampDays(days: number): number {
  if (!Number.isFinite(days)) return CONTACT_ANALYTICS_DEFAULT_DAYS
  return Math.min(CONTACT_ANALYTICS_MAX_DAYS, Math.max(1, Math.floor(days)))
}

function countBy(
  submissions: readonly SubmissionLike[],
  key: (s: SubmissionLike) => string,
): BreakdownEntry[] {
  const counts = new Map<string, number>()
  for (const submission of submissions) {
    const k = key(submission)
    counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([k, count]) => ({ key: k, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
}

/**
 * Totals plus status/queue/topic breakdowns over the given submissions.
 * Breakdown rows are sorted by count descending (key ascending as tiebreak)
 * and only include keys actually present — an empty store yields
 * `{ total: 0, byStatus: [], byQueue: [], byTopic: [] }`.
 */
export function summaryCounts(submissions: readonly SubmissionLike[]): ContactAnalyticsSummary {
  return {
    total: submissions.length,
    byStatus: countBy(submissions, (s) => s.status),
    byQueue: countBy(submissions, (s) => s.routedTo),
    byTopic: countBy(submissions, (s) => s.topic),
  }
}

/**
 * Per-queue counts with `percent` of the total (0 when the store is empty),
 * sorted by count descending. Covers every queue that appears in the input —
 * unknown queue strings pass through under their own key.
 */
export function queueBreakdown(submissions: readonly SubmissionLike[]): QueueBreakdownEntry[] {
  const total = submissions.length
  return summaryCounts(submissions).byQueue.map((entry) => ({
    ...entry,
    percent: total === 0 ? 0 : Math.round((entry.count / total) * 1000) / 10,
  }))
}

function utcDayKey(iso: string): string | null {
  const time = Date.parse(iso)
  if (Number.isNaN(time)) return null
  return new Date(time).toISOString().slice(0, 10)
}

/**
 * Daily submission volume for the last `days` UTC calendar days ending today
 * (`now` injectable for tests), zero-filled so charts render a continuous
 * axis. `days` is clamped to 1–90. Submissions with unparseable `createdAt`
 * are skipped; submissions older than the window are ignored.
 */
export function dailySeries(
  submissions: readonly SubmissionLike[],
  days = CONTACT_ANALYTICS_DEFAULT_DAYS,
  now: number = Date.now(),
): ContactDailyPoint[] {
  const windowDays = clampDays(days)
  const todayUtc = new Date(now)
  const startOfToday = Date.UTC(
    todayUtc.getUTCFullYear(),
    todayUtc.getUTCMonth(),
    todayUtc.getUTCDate(),
  )
  const windowStart = startOfToday - (windowDays - 1) * DAY_MS

  const series = new Map<string, number>()
  for (let i = 0; i < windowDays; i += 1) {
    series.set(new Date(windowStart + i * DAY_MS).toISOString().slice(0, 10), 0)
  }

  for (const submission of submissions) {
    const day = utcDayKey(submission.createdAt)
    if (day === null || !series.has(day)) continue
    series.set(day, (series.get(day) ?? 0) + 1)
  }

  return [...series.entries()].map(([date, count]) => ({ date, count }))
}

/**
 * One-shot aggregation for the analytics endpoint: summary counts, queue
 * breakdown, and the daily series. `days` is clamped to 1–90; `now` is
 * injectable for tests.
 */
export function buildContactAnalytics(
  submissions: readonly SubmissionLike[],
  {
    days = CONTACT_ANALYTICS_DEFAULT_DAYS,
    now = Date.now(),
  }: {
    days?: number
    now?: number
  } = {},
): ContactAnalytics {
  const windowDays = clampDays(days)
  return {
    days: windowDays,
    generatedAt: new Date(now).toISOString(),
    summary: summaryCounts(submissions),
    queueBreakdown: queueBreakdown(submissions),
    daily: dailySeries(submissions, windowDays, now),
  }
}
