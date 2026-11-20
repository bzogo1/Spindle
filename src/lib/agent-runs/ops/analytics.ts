/**
 * Agent run analytics — metrics aggregation over recorded runs.
 *
 * `aggregateRunAnalytics` folds a set of `AgentRunRecord`s into counts by
 * status and model, success rate, duration percentiles (nearest-rank), and
 * token/cost totals. Pure and deterministic; the analytics panel component
 * renders the result.
 */

import { isActiveOpsRun, runDurationMs, type AgentRunRecord, type AgentRunOpsStatus } from "./types"

export interface RunAnalyticsSummary {
  totalRuns: number
  /** Runs per lifecycle status (only statuses that occur are present). */
  byStatus: Partial<Record<AgentRunOpsStatus, number>>
  /** Runs per model key (`metrics.model` ?? `model` ?? "unknown"). */
  byModel: Record<string, number>
  /** succeeded / (succeeded + failed + cancelled + rejected). Active runs excluded. */
  successRate: number | null
  /** Terminal runs counted toward the success rate. */
  terminalRuns: number
  durationMs: {
    count: number
    min: number | null
    max: number | null
    avg: number | null
    p50: number | null
    p90: number | null
    p99: number | null
  }
  totals: {
    inputTokens: number
    outputTokens: number
    totalTokens: number
    costUsd: number
    /** Runs that reported at least one token/cost metric. */
    withMetrics: number
  }
  /** Most recent run start observed (ISO), when any run has timestamps. */
  latestRunAt: string | null
}

function modelKey(run: AgentRunRecord): string {
  return run.metrics.model ?? run.model ?? "unknown"
}

/** Nearest-rank percentile over an ascending-sorted array; null when empty. */
export function percentile(sortedAsc: readonly number[], p: number): number | null {
  if (sortedAsc.length === 0) return null
  if (p <= 0) return sortedAsc[0]
  if (p >= 100) return sortedAsc[sortedAsc.length - 1]
  const rank = Math.ceil((p / 100) * sortedAsc.length)
  return sortedAsc[Math.min(sortedAsc.length - 1, Math.max(0, rank - 1))]
}

export function aggregateRunAnalytics(
  runs: readonly AgentRunRecord[],
  options: { now?: number } = {},
): RunAnalyticsSummary {
  const now = options.now ?? Date.now()
  const byStatus: Partial<Record<AgentRunOpsStatus, number>> = {}
  const byModel: Record<string, number> = {}
  const durations: number[] = []
  const totals = { inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0, withMetrics: 0 }
  let terminalRuns = 0
  let succeeded = 0
  let latestRunAt: string | null = null

  for (const run of runs) {
    byStatus[run.status] = (byStatus[run.status] ?? 0) + 1
    const model = modelKey(run)
    byModel[model] = (byModel[model] ?? 0) + 1

    if (!isActiveOpsRun(run.status)) {
      terminalRuns += 1
      if (run.status === "succeeded") succeeded += 1
    }

    const duration = runDurationMs(run, now)
    if (duration !== null) durations.push(duration)

    const m = run.metrics
    const hasMetrics =
      typeof m.inputTokens === "number" ||
      typeof m.outputTokens === "number" ||
      typeof m.totalTokens === "number" ||
      typeof m.costUsd === "number"
    if (hasMetrics) {
      totals.withMetrics += 1
      totals.inputTokens += m.inputTokens ?? 0
      totals.outputTokens += m.outputTokens ?? 0
      totals.totalTokens += m.totalTokens ?? (m.inputTokens ?? 0) + (m.outputTokens ?? 0)
      totals.costUsd += m.costUsd ?? 0
    }

    const started = run.startedAt ?? run.createdAt
    if (!latestRunAt || started > latestRunAt) latestRunAt = started
  }

  durations.sort((a, b) => a - b)
  const sum = durations.reduce((acc, d) => acc + d, 0)

  return {
    totalRuns: runs.length,
    byStatus,
    byModel,
    successRate: terminalRuns > 0 ? succeeded / terminalRuns : null,
    terminalRuns,
    durationMs: {
      count: durations.length,
      min: durations.length ? durations[0] : null,
      max: durations.length ? durations[durations.length - 1] : null,
      avg: durations.length ? sum / durations.length : null,
      p50: percentile(durations, 50),
      p90: percentile(durations, 90),
      p99: percentile(durations, 99),
    },
    totals,
    latestRunAt,
  }
}

/** Status keys in canonical lifecycle order for stable rendering. */
export const RUN_STATUS_ORDER: readonly AgentRunOpsStatus[] = [
  "queued",
  "running",
  "waiting_approval",
  "succeeded",
  "failed",
  "cancelled",
  "rejected",
]
