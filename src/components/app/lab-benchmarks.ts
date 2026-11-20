/**
 * Performance-benchmark helpers for the Lab screen.
 *
 * Benchmark runs are simulated deterministic fixtures
 * (`labSnapshotBenchmarkRuns` in `lab-mock.ts`): each snapshot gets a seeded
 * history of render/capture timings. This module turns that history into
 * baselines (per-snapshot median), pairwise comparisons, and threshold
 * verdicts — pure functions so the panel stays thin and the logic is
 * unit-testable. Mirrors the warn/fail band shape of
 * `lab-snapshot-thresholds.ts`, but thresholds are ratios of the baseline
 * median rather than absolute pixel counts.
 */

import type { LabBenchmarkRun } from "./lab-mock"

/** Warn when a run's total is above the baseline median by this ratio (10%). */
export const DEFAULT_BENCHMARK_WARN_RATIO = 0.1
/** Fail when a run's total is above the baseline median by this ratio (25%). */
export const DEFAULT_BENCHMARK_FAIL_RATIO = 0.25

export type LabBenchmarkStatus = "pass" | "warn" | "fail"

export interface LabBenchmarkThresholds {
  /** Regression ratio vs baseline median that triggers a warning. */
  warnRatio?: number
  /** Regression ratio vs baseline median that triggers a failure. */
  failRatio?: number
}

/** Delta of `candidate` relative to `reference`, in ms and as a ratio. */
export interface LabBenchmarkComparison {
  renderDeltaMs: number
  captureDeltaMs: number
  totalDeltaMs: number
  /** `totalDeltaMs / reference.totalMs`; `null` when the reference is 0. */
  totalDeltaRatio: number | null
  /** True when the candidate finished faster than the reference. */
  faster: boolean
}

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

/**
 * Baseline total time for a snapshot's benchmark history: the median
 * `totalMs` across its seeded runs. Returns `null` for an empty history so
 * callers can render "no baseline" instead of comparing against 0.
 */
export function labBenchmarkBaseline(runs: LabBenchmarkRun[]): number | null {
  if (runs.length === 0) return null
  return median(runs.map((run) => run.totalMs))
}

/**
 * Classify a run against its snapshot's baseline median. `null` baseline
 * (empty history) yields `"pass"` — there is nothing to regress against.
 * A negative delta (faster than baseline) always passes.
 */
export function benchmarkRunStatus(
  run: LabBenchmarkRun,
  baselineMs: number | null,
  thresholds: LabBenchmarkThresholds = {},
): LabBenchmarkStatus {
  if (baselineMs === null || baselineMs <= 0) return "pass"
  const warnRatio = thresholds.warnRatio ?? DEFAULT_BENCHMARK_WARN_RATIO
  const failRatio = thresholds.failRatio ?? DEFAULT_BENCHMARK_FAIL_RATIO
  const deltaRatio = (run.totalMs - baselineMs) / baselineMs
  if (deltaRatio > failRatio) return "fail"
  if (deltaRatio > warnRatio) return "warn"
  return "pass"
}

/** Compare two benchmark runs; `candidate` is measured against `reference`. */
export function compareBenchmarkRuns(
  reference: LabBenchmarkRun,
  candidate: LabBenchmarkRun,
): LabBenchmarkComparison {
  const totalDeltaMs = candidate.totalMs - reference.totalMs
  return {
    renderDeltaMs: candidate.renderMs - reference.renderMs,
    captureDeltaMs: candidate.captureMs - reference.captureMs,
    totalDeltaMs,
    totalDeltaRatio: reference.totalMs > 0 ? totalDeltaMs / reference.totalMs : null,
    faster: totalDeltaMs < 0,
  }
}

export function benchmarkStatusLabel(status: LabBenchmarkStatus): string {
  if (status === "pass") return "Within budget"
  return status === "warn" ? "Warning" : "Regression"
}

export function benchmarkStatusBadgeClass(status: LabBenchmarkStatus): string {
  if (status === "pass") return "is-succeeded"
  return status === "warn" ? "is-warn" : "is-failed"
}

/** Signed duration like "+1.2s" / "−340ms"; uses an ASCII hyphen for safety. */
export function formatBenchmarkDelta(deltaMs: number): string {
  if (deltaMs === 0) return "±0ms"
  const sign = deltaMs > 0 ? "+" : "-"
  const magnitude = Math.abs(deltaMs)
  if (magnitude < 1000) return `${sign}${Math.round(magnitude)}ms`
  const seconds = magnitude / 1000
  return `${sign}${seconds >= 10 ? Math.round(seconds) : seconds.toFixed(1)}s`
}

/** Signed percent like "+12.5%"; `null` ratio formats as an em dash. */
export function formatBenchmarkDeltaRatio(ratio: number | null): string {
  if (ratio === null || !Number.isFinite(ratio)) return "—"
  const percent = ratio * 100
  const sign = percent > 0 ? "+" : percent < 0 ? "-" : "±"
  return `${sign}${Math.abs(percent).toFixed(1)}%`
}
