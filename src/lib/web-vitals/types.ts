/**
 * Core Web Vitals metric types.
 *
 * The collector in `./collector` produces these; sinks in `./sinks` ship them;
 * `./reporter` gates them on consent. Values and ratings mirror the
 * `web-vitals` library's semantics so reports stay comparable with Lighthouse
 * and CrUX, but the measurement itself is dependency-free (PerformanceObserver).
 */

export const VITALS_METRIC_NAMES = ["LCP", "CLS", "INP", "FCP", "TTFB"] as const
export type VitalsMetricName = (typeof VITALS_METRIC_NAMES)[number]

export type VitalsRating = "good" | "needs-improvement" | "poor"

export type VitalsMetric = {
  name: VitalsMetricName
  /**
   * Metric value in the unit the `web-vitals` library reports: milliseconds
   * for LCP/FCP/INP/TTFB, unitless for CLS.
   */
  value: number
  rating: VitalsRating
  /** Stable identifier for this page load's measurement of the metric. */
  id: string
  /** Epoch milliseconds when the metric was finalized and reported. */
  timestamp: number
  /** Path the metric was measured on, when known. */
  path?: string
}

/**
 * Destination for finalized metrics. Implementations must be best-effort:
 * a throwing `record()` is swallowed by the reporter so telemetry can never
 * break the app. `flush()` drains buffered/batched metrics (e.g. on pagehide).
 */
export interface VitalsSink {
  record(metric: VitalsMetric): void
  flush?(): void | Promise<void>
}

/**
 * "good"/"needs-improvement"/"poor" thresholds, matching the Core Web Vitals
 * guidance (web.dev) and the `web-vitals` library defaults.
 */
const RATING_THRESHOLDS: Record<VitalsMetricName, readonly [number, number]> = {
  LCP: [2500, 4000],
  CLS: [0.1, 0.25],
  INP: [200, 500],
  FCP: [1800, 3000],
  TTFB: [800, 1800],
}

export function rateVitalsMetric(name: VitalsMetricName, value: number): VitalsRating {
  const [goodMax, poorMax] = RATING_THRESHOLDS[name]
  if (value <= goodMax) return "good"
  if (value <= poorMax) return "needs-improvement"
  return "poor"
}
