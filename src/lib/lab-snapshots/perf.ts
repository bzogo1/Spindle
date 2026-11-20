/**
 * Client-side performance profiling for snapshot captures.
 *
 * Providers (or the capture harness) report per-capture metrics — timings,
 * payload sizes — which this module compares against stored baselines and
 * absolute thresholds to flag regressions. Pure functions; storage/CLI live
 * in `scripts/`.
 */

export interface CaptureMetrics {
  /** Snapshot/case name this capture belongs to. */
  name: string
  /** Wall-clock capture duration in milliseconds. */
  durationMs: number
  /** PNG payload size in bytes (sum across images when a run has several). */
  bytes: number
  /** Optional breakdowns for richer reports. */
  width?: number
  height?: number
  imageCount?: number
  /** When the capture happened (ISO string or epoch ms). */
  capturedAt?: string | number
  /** Free-form provider metadata echoed into the report. */
  meta?: Record<string, unknown>
}

/** Per-metric baseline statistics accumulated over previous captures. */
export interface PerfBaselineEntry {
  name: string
  samples: number
  medianDurationMs: number
  medianBytes: number
  /** Worst (max) observed values — useful for tail-latency gates. */
  maxDurationMs: number
  maxBytes: number
}

/** Absolute ceilings applied regardless of baseline. */
export interface PerfThresholds {
  maxDurationMs?: number
  maxBytes?: number
  /**
   * Allowed regression vs baseline median, as a fraction (0.2 = +20%).
   * Default 0.25 when a baseline exists.
   */
  maxRegressionRatio?: number
}

export type PerfSeverity = "info" | "warning" | "critical"

export interface PerfFinding {
  name: string
  metric: "durationMs" | "bytes"
  value: number
  /** Baseline median the value was compared against, when available. */
  baseline?: number
  /** `(value - baseline) / baseline` when a baseline exists. */
  deltaRatio?: number
  /** Which gate tripped: absolute threshold or baseline regression. */
  reason: "threshold" | "regression"
  severity: PerfSeverity
  message: string
}

export interface PerfReport {
  pass: boolean
  findings: PerfFinding[]
  /** One-line-per-capture summary for logs/UI. */
  summary: string[]
  evaluatedAt: string
}

export const DEFAULT_MAX_REGRESSION_RATIO = 0.25

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

/**
 * Fold a stream of `CaptureMetrics` into per-name baseline entries.
 * `previous` entries are merged so baselines accumulate across runs.
 */
export function buildPerfBaselines(
  metrics: CaptureMetrics[],
  previous: PerfBaselineEntry[] = [],
): PerfBaselineEntry[] {
  const byName = new Map<string, { durations: number[]; bytes: number[] }>()
  for (const entry of previous) {
    // Rehydrate synthetic samples: we only stored medians/maxes, so weight
    // them as single samples to keep the fold stable and simple.
    byName.set(entry.name, {
      durations: [entry.medianDurationMs, entry.maxDurationMs],
      bytes: [entry.medianBytes, entry.maxBytes],
    })
  }
  for (const m of metrics) {
    const slot = byName.get(m.name) ?? { durations: [], bytes: [] }
    slot.durations.push(m.durationMs)
    slot.bytes.push(m.bytes)
    byName.set(m.name, slot)
  }
  return [...byName.entries()].map(([name, slot]) => ({
    name,
    samples: slot.durations.length,
    medianDurationMs: median(slot.durations),
    medianBytes: median(slot.bytes),
    maxDurationMs: Math.max(...slot.durations),
    maxBytes: Math.max(...slot.bytes),
  }))
}

/**
 * Regression severity scales with the configured gate: anything past
 * `max(50%, 2× gate)` is critical, everything else that tripped the gate is a
 * warning. Scaling by the gate keeps the warning band reachable for any
 * `maxRegressionRatio` (e.g. a strict 5% gate still yields warnings at
 * 5–10% drift instead of instantly going critical).
 */
function severityFor(deltaRatio: number, gate: number): PerfSeverity {
  return deltaRatio >= Math.max(0.5, gate * 2) ? "critical" : "warning"
}

/**
 * Evaluate capture metrics against absolute thresholds and (optionally)
 * stored baselines. Returns a report; `pass` is false on any critical
 * finding (warnings alone do not fail the run).
 */
export function evaluatePerfReport(
  metrics: CaptureMetrics[],
  baselines: PerfBaselineEntry[] = [],
  thresholds: PerfThresholds = {},
): PerfReport {
  const baselineByName = new Map(baselines.map((b) => [b.name, b]))
  const maxRegression = thresholds.maxRegressionRatio ?? DEFAULT_MAX_REGRESSION_RATIO
  const findings: PerfFinding[] = []
  const summary: string[] = []

  for (const m of metrics) {
    const baseline = baselineByName.get(m.name)
    const parts = [`${m.name}: ${Math.round(m.durationMs)}ms, ${(m.bytes / 1024).toFixed(1)}KiB`]

    if (thresholds.maxDurationMs !== undefined && m.durationMs > thresholds.maxDurationMs) {
      findings.push({
        name: m.name,
        metric: "durationMs",
        value: m.durationMs,
        baseline: baseline?.medianDurationMs,
        reason: "threshold",
        severity: "critical",
        message: `duration ${Math.round(m.durationMs)}ms exceeds threshold ${thresholds.maxDurationMs}ms`,
      })
      parts.push(`duration over threshold`)
    }
    if (thresholds.maxBytes !== undefined && m.bytes > thresholds.maxBytes) {
      findings.push({
        name: m.name,
        metric: "bytes",
        value: m.bytes,
        baseline: baseline?.medianBytes,
        reason: "threshold",
        severity: "critical",
        message: `size ${m.bytes}B exceeds threshold ${thresholds.maxBytes}B`,
      })
      parts.push(`size over threshold`)
    }

    if (baseline && baseline.samples > 0) {
      for (const [metric, value, base] of [
        ["durationMs", m.durationMs, baseline.medianDurationMs],
        ["bytes", m.bytes, baseline.medianBytes],
      ] as const) {
        if (base <= 0) continue
        const deltaRatio = (value - base) / base
        if (deltaRatio > maxRegression) {
          findings.push({
            name: m.name,
            metric,
            value,
            baseline: base,
            deltaRatio,
            reason: "regression",
            severity: severityFor(deltaRatio, maxRegression),
            message: `${metric} regressed ${(deltaRatio * 100).toFixed(0)}% vs baseline median ${Math.round(base)}`,
          })
          parts.push(`${metric} +${(deltaRatio * 100).toFixed(0)}% vs baseline`)
        }
      }
    }
    summary.push(parts.join(" — "))
  }

  const pass = !findings.some((f) => f.severity === "critical")
  return { pass, findings, summary, evaluatedAt: new Date().toISOString() }
}
