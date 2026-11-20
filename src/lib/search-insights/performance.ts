import type { SearchEvent } from "./schema"

/**
 * Search performance monitoring (task 50).
 *
 * Latency samples come from `search_performance` events (and the optional
 * `latencyMs` on `query_submitted`). Index size and cache hit rate are
 * aggregated from the same events. `evaluatePerformance` applies thresholds
 * and returns warnings the dashboard perf panel renders.
 */

/** Latency budgets in ms — warnings fire above these. */
export const PERF_THRESHOLDS = {
  /** p95 query latency above this warns. */
  latencyP95Ms: 100,
  /** Mean latency above this warns. */
  latencyMeanMs: 50,
  /** Cache hit rate below this warns. */
  minCacheHitRate: 0.5,
  /** Index size above this warns (prepared-scan cost grows linearly). */
  maxItemCount: 5000,
} as const

export type PerformanceStats = {
  samples: number
  meanLatencyMs: number
  p50LatencyMs: number
  p95LatencyMs: number
  maxLatencyMs: number
  /** Mean index size observed at query time. */
  meanItemCount: number
  maxItemCount: number
  /** cacheHit samples / total samples with a cacheHit flag, 0..1. */
  cacheHitRate: number
  cacheHits: number
  cacheMisses: number
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
  return sorted[Math.max(0, index)] ?? 0
}

export function computePerformanceStats(events: SearchEvent[]): PerformanceStats {
  const latencies: number[] = []
  const itemCounts: number[] = []
  let cacheHits = 0
  let cacheMisses = 0

  for (const event of events) {
    if (event.type === "search_performance") {
      latencies.push(event.latencyMs)
      itemCounts.push(event.itemCount)
      if (event.cacheHit === true) cacheHits += 1
      else if (event.cacheHit === false) cacheMisses += 1
    } else if (event.type === "query_submitted") {
      if (event.latencyMs !== undefined) latencies.push(event.latencyMs)
      if (event.itemCount !== undefined) itemCounts.push(event.itemCount)
      if (event.cacheHit === true) cacheHits += 1
      else if (event.cacheHit === false) cacheMisses += 1
    }
  }

  latencies.sort((a, b) => a - b)
  const total = latencies.length
  const cacheTotal = cacheHits + cacheMisses

  return {
    samples: total,
    meanLatencyMs: total > 0 ? latencies.reduce((a, b) => a + b, 0) / total : 0,
    p50LatencyMs: percentile(latencies, 50),
    p95LatencyMs: percentile(latencies, 95),
    maxLatencyMs: latencies.length > 0 ? latencies[latencies.length - 1]! : 0,
    meanItemCount:
      itemCounts.length > 0 ? itemCounts.reduce((a, b) => a + b, 0) / itemCounts.length : 0,
    maxItemCount: itemCounts.length > 0 ? Math.max(...itemCounts) : 0,
    cacheHitRate: cacheTotal > 0 ? cacheHits / cacheTotal : 0,
    cacheHits,
    cacheMisses,
  }
}

export type PerformanceWarning = {
  level: "warning" | "critical"
  metric: "latency" | "cache" | "indexSize"
  message: string
}

/** Apply thresholds to stats; returns warnings sorted critical-first. */
export function evaluatePerformance(
  stats: PerformanceStats,
  thresholds: Partial<typeof PERF_THRESHOLDS> = {},
): PerformanceWarning[] {
  const t = { ...PERF_THRESHOLDS, ...thresholds }
  const warnings: PerformanceWarning[] = []

  if (stats.samples === 0) return warnings

  if (stats.p95LatencyMs > t.latencyP95Ms) {
    warnings.push({
      level: stats.p95LatencyMs > t.latencyP95Ms * 2 ? "critical" : "warning",
      metric: "latency",
      message: `p95 query latency ${stats.p95LatencyMs.toFixed(0)}ms exceeds ${t.latencyP95Ms}ms budget`,
    })
  } else if (stats.meanLatencyMs > t.latencyMeanMs) {
    warnings.push({
      level: "warning",
      metric: "latency",
      message: `mean query latency ${stats.meanLatencyMs.toFixed(0)}ms exceeds ${t.latencyMeanMs}ms budget`,
    })
  }

  if (stats.cacheHits + stats.cacheMisses > 0 && stats.cacheHitRate < t.minCacheHitRate) {
    warnings.push({
      level: "warning",
      metric: "cache",
      message: `cache hit rate ${(stats.cacheHitRate * 100).toFixed(0)}% below ${(t.minCacheHitRate * 100).toFixed(0)}% target`,
    })
  }

  if (stats.maxItemCount > t.maxItemCount) {
    warnings.push({
      level: "warning",
      metric: "indexSize",
      message: `index size ${stats.maxItemCount} items exceeds ${t.maxItemCount} — consider incremental prepare`,
    })
  }

  return warnings.sort((a, b) => (a.level === b.level ? 0 : a.level === "critical" ? -1 : 1))
}
