import { describe, expect, it } from "vitest"

import { computePerformanceStats, evaluatePerformance, PERF_THRESHOLDS } from "./performance"
import { SEARCH_EVENTS_SCHEMA_VERSION, type SearchEvent } from "./schema"

function perf(latencyMs: number, itemCount = 100, cacheHit?: boolean): SearchEvent {
  return {
    schemaVersion: SEARCH_EVENTS_SCHEMA_VERSION,
    ts: 1,
    type: "search_performance",
    latencyMs,
    itemCount,
    cacheHit,
  }
}

describe("computePerformanceStats", () => {
  it("returns zeros for no samples", () => {
    const stats = computePerformanceStats([])
    expect(stats.samples).toBe(0)
    expect(stats.p95LatencyMs).toBe(0)
    expect(stats.cacheHitRate).toBe(0)
  })

  it("aggregates latency percentiles, index size, cache hits", () => {
    const events = [
      perf(10, 100, true),
      perf(20, 200, true),
      perf(30, 300, false),
      perf(1000, 400, false),
    ]
    const stats = computePerformanceStats(events)
    expect(stats.samples).toBe(4)
    expect(stats.meanLatencyMs).toBeCloseTo(265)
    expect(stats.p50LatencyMs).toBe(20)
    expect(stats.p95LatencyMs).toBe(1000)
    expect(stats.maxLatencyMs).toBe(1000)
    expect(stats.meanItemCount).toBe(250)
    expect(stats.maxItemCount).toBe(400)
    expect(stats.cacheHitRate).toBeCloseTo(0.5)
  })

  it("also reads latency/itemCount/cacheHit off query_submitted", () => {
    const events: SearchEvent[] = [
      {
        schemaVersion: SEARCH_EVENTS_SCHEMA_VERSION,
        ts: 1,
        type: "query_submitted",
        query: "x",
        resultCount: 1,
        latencyMs: 42,
        itemCount: 77,
        cacheHit: true,
      },
    ]
    const stats = computePerformanceStats(events)
    expect(stats.samples).toBe(1)
    expect(stats.p95LatencyMs).toBe(42)
    expect(stats.meanItemCount).toBe(77)
    expect(stats.cacheHitRate).toBe(1)
  })
})

describe("evaluatePerformance", () => {
  it("returns no warnings with no samples", () => {
    expect(evaluatePerformance(computePerformanceStats([]))).toEqual([])
  })

  it("warns on high p95 latency", () => {
    const stats = computePerformanceStats([perf(500, 100, true)])
    const warnings = evaluatePerformance(stats)
    expect(warnings.some((w) => w.metric === "latency")).toBe(true)
  })

  it("warns on low cache hit rate", () => {
    const stats = computePerformanceStats([
      perf(10, 100, false),
      perf(10, 100, false),
      perf(10, 100, true),
    ])
    const warnings = evaluatePerformance(stats)
    expect(warnings.some((w) => w.metric === "cache")).toBe(true)
  })

  it("warns on oversized index", () => {
    const stats = computePerformanceStats([perf(10, PERF_THRESHOLDS.maxItemCount + 1, true)])
    const warnings = evaluatePerformance(stats)
    expect(warnings.some((w) => w.metric === "indexSize")).toBe(true)
  })

  it("is clean for healthy stats", () => {
    const stats = computePerformanceStats([
      perf(10, 100, true),
      perf(12, 100, true),
      perf(11, 100, false),
    ])
    expect(evaluatePerformance(stats)).toEqual([])
  })
})
