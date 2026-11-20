/**
 * Metric gates for canary stages.
 *
 * Metrics collection sits behind the MetricsSource interface so the rollout
 * logic is testable and router-agnostic. Two implementations ship here:
 *
 *   - HttpMetricsSource: GETs SPINDLE_CANARY_METRICS_URL and expects a JSON
 *     document shaped like MetricsWindow. Point it at whatever exposes the
 *     canary's error rate and latency percentiles (a metrics gateway, a
 *     sidecar endpoint, or a small adapter over Prometheus).
 *   - NullMetricsSource: used when no URL is configured. It reports an empty
 *     window; the gate then SKIPS unless SPINDLE_CANARY_REQUIRE_METRICS=1.
 *     This keeps the tooling runnable before a metrics pipeline exists.
 */

import type { CanaryConfig } from "./config"

/** One observation window of canary traffic. */
export interface MetricsWindow {
  /** Requests observed inside the window. */
  requests: number
  /** Fraction of requests that failed (0–1). */
  errorRate: number
  /** 95th-percentile latency in milliseconds. */
  p95LatencyMs: number
  /** Window length in seconds, echoed back for logging. */
  windowSeconds: number
}

export interface MetricsSource {
  readonly name: string
  windowStats(windowSeconds: number): Promise<MetricsWindow>
}

function isMetricsWindow(value: unknown): value is MetricsWindow {
  if (typeof value !== "object" || value === null) return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.requests === "number" &&
    typeof candidate.errorRate === "number" &&
    typeof candidate.p95LatencyMs === "number"
  )
}

export class HttpMetricsSource implements MetricsSource {
  readonly name = "http"

  constructor(
    private readonly url: string,
    private readonly timeoutMs = 10_000,
  ) {}

  async windowStats(windowSeconds: number): Promise<MetricsWindow> {
    const response = await fetch(this.url, {
      signal: AbortSignal.timeout(this.timeoutMs),
      headers: { accept: "application/json" },
    })
    if (!response.ok) {
      throw new Error(`Metrics endpoint returned HTTP ${response.status}`)
    }
    const body: unknown = await response.json()
    if (!isMetricsWindow(body)) {
      throw new Error(
        "Metrics endpoint returned an unexpected shape; expected " +
          "{ requests, errorRate, p95LatencyMs }",
      )
    }
    return { ...body, windowSeconds }
  }
}

export class NullMetricsSource implements MetricsSource {
  readonly name = "none"

  async windowStats(windowSeconds: number): Promise<MetricsWindow> {
    return { requests: 0, errorRate: 0, p95LatencyMs: 0, windowSeconds }
  }
}

export function createMetricsSource(config: CanaryConfig): MetricsSource {
  return config.metricsUrl ? new HttpMetricsSource(config.metricsUrl) : new NullMetricsSource()
}

export interface GateResult {
  pass: boolean
  /** Human-readable reasons; empty when pass is true. */
  reasons: string[]
  /** The window the verdict was based on, when metrics were collected. */
  window?: MetricsWindow
}

/**
 * Evaluate one observation window against the configured thresholds.
 * A window with too few requests cannot prove the canary is healthy, so it
 * fails the gate rather than passing on silence.
 */
export function evaluateMetricGate(config: CanaryConfig, window: MetricsWindow): GateResult {
  const reasons: string[] = []

  if (window.requests < config.minRequests) {
    reasons.push(
      `only ${window.requests} requests observed (minimum ${config.minRequests}); ` +
        "insufficient traffic to judge the canary",
    )
  }
  if (window.errorRate > config.maxErrorRate) {
    reasons.push(
      `error rate ${(window.errorRate * 100).toFixed(2)}% exceeds ` +
        `${(config.maxErrorRate * 100).toFixed(2)}%`,
    )
  }
  if (window.p95LatencyMs > config.maxP95LatencyMs) {
    reasons.push(
      `p95 latency ${window.p95LatencyMs.toFixed(0)}ms exceeds ${config.maxP95LatencyMs}ms`,
    )
  }

  return { pass: reasons.length === 0, reasons, window }
}
