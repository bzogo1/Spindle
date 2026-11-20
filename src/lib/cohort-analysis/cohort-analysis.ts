/**
 * Cohort analysis — acquisition-cohort retention matrix.
 *
 * This module is the typed facade over the dependency-free implementation in
 * `scripts/analytics/cohorts/cohort-core.mjs`, which is shared verbatim with
 * the CLI report generator (`scripts/analytics/cohorts/report.mjs`) so the
 * library and the offline tooling can never drift apart.
 *
 * Relationship to `src/lib/cohorts.ts` (read-only, owned elsewhere):
 * `cohorts.ts` serves `GET /api/cohorts` from a fixed-shape
 * `CohortUserInput[]` (id + signedUpAt + weeklyActivity counts). This module
 * accepts *raw* records — signup rows, timestamped activity events, or
 * pre-aggregated weekly counts — normalizes them into the same per-user
 * shape, and adds a pooled retention curve plus text/markdown renderers for
 * offline analysis. When a real user/activity store lands, feed its rows in
 * as records and the math stays unchanged.
 */

import {
  analyzeRecords as analyzeRecordsCore,
  classifyRecord,
  computeRetentionMatrix as computeRetentionMatrixCore,
  DEFAULT_MAX_COHORTS,
  DEFAULT_WEEKS,
  formatMarkdownReport as formatMarkdownReportCore,
  formatTextReport as formatTextReportCore,
  generateDemoRecords,
  recordsToUsers as recordsToUsersCore,
  WEEK_MS,
  weekStartUtc,
} from "../../../scripts/analytics/cohorts/cohort-core.mjs"

export {
  DEFAULT_MAX_COHORTS,
  DEFAULT_WEEKS,
  WEEK_MS,
  classifyRecord,
  generateDemoRecords,
  weekStartUtc,
}

export interface NormalizedCohortUser {
  id: string
  /** ms epoch of account creation. */
  signedUpAtMs: number
  /** Activity event counts per week offset from the signup week (W0 first). */
  weeklyActivity: number[]
}

export interface CohortCell {
  /** Week offset from the cohort's signup week (0-based). */
  week: number
  /** ISO timestamp of that week's Monday 00:00 UTC. */
  weekStart: string
  /** Users in the cohort with activity > 0 during that week. */
  activeUsers: number
  /** activeUsers / cohort size; null while the week is still in progress. */
  retention: number | null
  /** False while the week is still in progress. */
  complete: boolean
}

export interface CohortRow {
  /** ISO timestamp of the signup week's Monday. */
  weekStart: string
  /** Display label, e.g. "Nov 10". */
  label: string
  size: number
  /** Users with no activity in the cohort's latest complete week. */
  inactiveLatestWeek: number
  /** Mean weeks active across fully-elapsed weeks only. */
  avgActiveWeeks: number
  cells: CohortCell[]
}

export interface RetentionCurvePoint {
  week: number
  /** Cohorts contributing a complete cell for this offset. */
  cohorts: number
  activeUsers: number
  cohortSize: number
  retention: number | null
}

export interface CohortAnalysisReport {
  generatedAt: string
  dataSource: "external"
  weeks: number
  cohorts: CohortRow[]
  curve: RetentionCurvePoint[]
  totals: {
    users: number
    excludedUsers: number
    activeThisWeek: number
  }
  /** Present when built via analyzeRecords — input diagnostics. */
  input?: {
    records: number
    signups: number
    preAggregated: number
    activityRecords: number
    unclassifiable: number
    invalidTimestamps: number
    orphanActivity: number
    excludedUsers: number
  }
}

export interface RecordsToUsersResult {
  users: NormalizedCohortUser[]
  /** Users skipped because they had activity but no parseable signup. */
  excludedUsers: number
  stats: {
    records: number
    signups: number
    preAggregated: number
    activityRecords: number
    unclassifiable: number
    invalidTimestamps: number
    orphanActivity: number
  }
}

export interface AnalysisOptions {
  /** Reference time for "week complete" checks. Defaults to now. */
  now?: Date | number | string
  /** Number of weekly columns (W0 … W{weeks-1}). Default 8. */
  weeks?: number
  /** Most recent signup-week cohorts to include. Default 12. */
  maxCohorts?: number
}

/**
 * Group raw records into normalized per-user cohort input.
 * Accepts signup rows, timestamped activity events, and pre-aggregated
 * `weeklyActivity` users — see `classifyRecord` for the accepted shapes.
 */
export function recordsToUsers(
  records: Array<Record<string, unknown>>,
  options: Pick<AnalysisOptions, "weeks"> = {},
): RecordsToUsersResult {
  return recordsToUsersCore(records, options) as RecordsToUsersResult
}

/**
 * Compute the acquisition-cohort retention matrix: users grouped by signup
 * week (Monday UTC), with % of each cohort active in each subsequent week.
 */
export function computeRetentionMatrix(
  users: NormalizedCohortUser[],
  options: AnalysisOptions = {},
): CohortAnalysisReport {
  return computeRetentionMatrixCore(users, options) as CohortAnalysisReport
}

/** Records → users → matrix in one call. Attaches input diagnostics. */
export function analyzeRecords(
  records: Array<Record<string, unknown>>,
  options: AnalysisOptions = {},
): CohortAnalysisReport {
  return analyzeRecordsCore(records, options) as CohortAnalysisReport
}

/** Plain-text rendering of the matrix (tab-separated cohort rows). */
export function formatTextReport(report: CohortAnalysisReport): string {
  return formatTextReportCore(report)
}

/** Markdown rendering of the matrix plus the pooled retention curve. */
export function formatMarkdownReport(report: CohortAnalysisReport): string {
  return formatMarkdownReportCore(report)
}
