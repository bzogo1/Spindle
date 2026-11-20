import { describe, expect, it } from "vitest"

import { aggregateRunAnalytics, percentile, RUN_STATUS_ORDER } from "./analytics"
import { buildOpsRun } from "./fixtures"
import type { AgentRunRecord } from "./types"

const NOW = new Date("2026-11-19T12:00:00.000Z").getTime()

function runWith(partial: Partial<AgentRunRecord>): AgentRunRecord {
  return buildOpsRun(partial)
}

describe("analytics", () => {
  it("percentile uses nearest-rank on ascending input", () => {
    expect(percentile([], 50)).toBeNull()
    expect(percentile([10, 20, 30, 40], 50)).toBe(20)
    expect(percentile([10, 20, 30, 40], 90)).toBe(40)
    expect(percentile([10, 20, 30, 40], 0)).toBe(10)
    expect(percentile([10, 20, 30, 40], 100)).toBe(40)
    expect(percentile([5], 99)).toBe(5)
  })

  it("aggregates counts by status and model", () => {
    const runs = [
      runWith({ id: "r1", status: "succeeded", model: "m-a", metrics: { model: "m-a" } }),
      runWith({ id: "r2", status: "failed", model: "m-b", metrics: { model: "m-b" } }),
      runWith({ id: "r3", status: "running", model: undefined, metrics: {} }),
    ]
    const summary = aggregateRunAnalytics(runs, { now: NOW })
    expect(summary.totalRuns).toBe(3)
    expect(summary.byStatus.succeeded).toBe(1)
    expect(summary.byStatus.failed).toBe(1)
    expect(summary.byStatus.running).toBe(1)
    expect(summary.byModel["m-a"]).toBe(1)
    expect(summary.byModel["m-b"]).toBe(1)
    expect(summary.byModel.unknown).toBe(1)
  })

  it("computes success rate over terminal runs only", () => {
    const runs = [
      runWith({ id: "r1", status: "succeeded" }),
      runWith({ id: "r2", status: "succeeded" }),
      runWith({ id: "r3", status: "failed" }),
      runWith({ id: "r4", status: "cancelled" }),
      runWith({ id: "r5", status: "running" }), // excluded
    ]
    const summary = aggregateRunAnalytics(runs, { now: NOW })
    expect(summary.terminalRuns).toBe(4)
    expect(summary.successRate).toBeCloseTo(0.5)
  })

  it("returns null success rate when nothing is terminal", () => {
    const summary = aggregateRunAnalytics([runWith({ status: "queued" })], { now: NOW })
    expect(summary.successRate).toBeNull()
    expect(summary.terminalRuns).toBe(0)
  })

  it("computes duration stats and percentiles", () => {
    const mk = (id: string, ms: number) =>
      runWith({
        id,
        status: "succeeded",
        createdAt: "2026-11-19T09:00:00.000Z",
        startedAt: "2026-11-19T09:00:00.000Z",
        finishedAt: new Date(new Date("2026-11-19T09:00:00.000Z").getTime() + ms).toISOString(),
      })
    const runs = [mk("a", 1000), mk("b", 2000), mk("c", 3000), mk("d", 4000)]
    const summary = aggregateRunAnalytics(runs, { now: NOW })
    expect(summary.durationMs.count).toBe(4)
    expect(summary.durationMs.min).toBe(1000)
    expect(summary.durationMs.max).toBe(4000)
    expect(summary.durationMs.avg).toBe(2500)
    expect(summary.durationMs.p50).toBe(2000)
    expect(summary.durationMs.p90).toBe(4000)
    expect(summary.durationMs.p99).toBe(4000)
  })

  it("totals tokens and cost, counting runs with metrics", () => {
    const runs = [
      runWith({ id: "r1", metrics: { inputTokens: 100, outputTokens: 50, costUsd: 0.01 } }),
      runWith({ id: "r2", metrics: { inputTokens: 200, totalTokens: 260, costUsd: 0.02 } }),
      runWith({ id: "r3", metrics: {} }),
    ]
    const summary = aggregateRunAnalytics(runs, { now: NOW })
    expect(summary.totals.withMetrics).toBe(2)
    expect(summary.totals.inputTokens).toBe(300)
    expect(summary.totals.outputTokens).toBe(50)
    // r2 has no outputTokens; totalTokens 260 is used as-is, r1 derives 150.
    expect(summary.totals.totalTokens).toBe(150 + 260)
    expect(summary.totals.costUsd).toBeCloseTo(0.03)
  })

  it("handles empty input", () => {
    const summary = aggregateRunAnalytics([], { now: NOW })
    expect(summary.totalRuns).toBe(0)
    expect(summary.durationMs.p50).toBeNull()
    expect(summary.latestRunAt).toBeNull()
    expect(summary.totals.costUsd).toBe(0)
  })

  it("exposes canonical status order", () => {
    expect(RUN_STATUS_ORDER[0]).toBe("queued")
    expect(RUN_STATUS_ORDER).toContain("succeeded")
  })
})
