/**
 * Automation run analytics — per-automation and workspace-level stats folded
 * from recorded runs.
 *
 * Pure and deterministic: the automations panel feeds its mock `runs` arrays
 * (status, startedAt, optional durationMs) through `automationStats` /
 * `workspaceAutomationStats` and renders the result. When the automations API
 * lands the same helpers can consume server payloads unchanged.
 */

export type AutomationRunStatsInput = {
  status: string
  startedAt: string
  /** Wall-clock duration in milliseconds; absent while a run is in flight. */
  durationMs?: number | null
}

export type AutomationStats = {
  /** All recorded runs, including queued/running. */
  runCount: number
  succeededCount: number
  failedCount: number
  /**
   * succeeded / terminal runs (succeeded + failed + cancelled). Runs still
   * queued or running are excluded; null when no run has reached a terminal
   * state yet.
   */
  successRate: number | null
  /** Terminal runs counted toward the success rate. */
  terminalRuns: number
  /** Mean durationMs across runs that report one; null when none do. */
  avgDurationMs: number | null
  /** Most recent run start observed (ISO), when any run has a timestamp. */
  lastRunAt: string | null
}

/** Statuses that count toward the success-rate denominator. */
const TERMINAL_STATUSES = new Set(["succeeded", "failed", "cancelled"])

export function automationStats(runs: readonly AutomationRunStatsInput[]): AutomationStats {
  let succeededCount = 0
  let failedCount = 0
  let terminalRuns = 0
  let durationTotal = 0
  let durationCount = 0
  let lastRunAt: string | null = null

  for (const run of runs) {
    if (TERMINAL_STATUSES.has(run.status)) {
      terminalRuns += 1
      if (run.status === "succeeded") succeededCount += 1
      if (run.status === "failed") failedCount += 1
    }

    const duration = run.durationMs
    if (typeof duration === "number" && Number.isFinite(duration) && duration >= 0) {
      durationTotal += duration
      durationCount += 1
    }

    if (run.startedAt && (!lastRunAt || run.startedAt > lastRunAt)) {
      lastRunAt = run.startedAt
    }
  }

  return {
    runCount: runs.length,
    succeededCount,
    failedCount,
    successRate: terminalRuns > 0 ? succeededCount / terminalRuns : null,
    terminalRuns,
    avgDurationMs: durationCount > 0 ? durationTotal / durationCount : null,
    lastRunAt,
  }
}

/**
 * Workspace-level rollup: every automation contributes its runs to a single
 * stats object, so `runCount`/`successRate`/`avgDurationMs` describe the whole
 * workspace rather than one automation.
 */
export function workspaceAutomationStats(
  automations: readonly { runs: readonly AutomationRunStatsInput[] }[],
): AutomationStats {
  const runs = automations.flatMap((automation) => automation.runs)
  return automationStats(runs)
}
