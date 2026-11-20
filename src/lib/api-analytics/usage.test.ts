import { describe, expect, it } from "vitest"

import { aggregateApiUsage, summarizeDurations } from "@/lib/api-analytics/usage"
import type { ApiRequestRecord } from "@/lib/api-analytics/usage"

function req(overrides: Partial<ApiRequestRecord> = {}): ApiRequestRecord {
  return {
    event: "api.request",
    method: "GET",
    path: "/api/projects",
    status: 200,
    durationMs: 10,
    userId: "user_a",
    projectId: "proj_1",
    time: "2025-01-01T00:00:00.000Z",
    ...overrides,
  }
}

describe("summarizeDurations", () => {
  it("returns null for empty input", () => {
    expect(summarizeDurations([])).toBeNull()
  })

  it("computes percentiles with interpolation", () => {
    const summary = summarizeDurations([10, 20, 30, 40])
    expect(summary).not.toBeNull()
    expect(summary?.count).toBe(4)
    expect(summary?.min).toBe(10)
    expect(summary?.max).toBe(40)
    expect(summary?.avg).toBe(25)
    expect(summary?.p50).toBe(25)
    expect(summary?.p95).toBe(38.5)
  })
})

describe("aggregateApiUsage", () => {
  it("returns an empty report for no records", () => {
    const report = aggregateApiUsage([])
    expect(report.totals.requests).toBe(0)
    expect(report.latencyMs).toBeNull()
    expect(report.endpoints).toEqual([])
    expect(report.topUsers).toEqual([])
    expect(report.window.first).toBeNull()
  })

  it("ignores records that are not api.request events", () => {
    const records = [
      req(),
      { event: "db.query", durationMs: 5 },
      { event: "worker.job", msg: "job failed" },
      { msg: "plain log line" },
    ]
    const report = aggregateApiUsage(records)
    expect(report.totals.requests).toBe(1)
    expect(report.lines.requests).toBe(1)
  })

  it("honours a custom requestEvent", () => {
    const records = [
      { event: "http.request", method: "GET", path: "/x", status: 200, durationMs: 1 },
      req(),
    ]
    const report = aggregateApiUsage(records, { requestEvent: "http.request" })
    expect(report.totals.requests).toBe(1)
    expect(report.requestEvent).toBe("http.request")
  })

  it("counts requests, errors, and splits 4xx vs 5xx", () => {
    const records = [
      req({ status: 200 }),
      req({ status: 201 }),
      req({ status: 404 }),
      req({ status: 500, error: { type: "Error", message: "boom" } }),
      req({ status: 503 }),
    ]
    const report = aggregateApiUsage(records)
    expect(report.totals.requests).toBe(5)
    expect(report.totals.errors).toBe(3)
    expect(report.totals.serverErrors).toBe(2)
    expect(report.totals.clientErrors).toBe(1)
    expect(report.totals.errorRate).toBeCloseTo(0.6)
    expect(report.statusDistribution).toEqual({ "200": 1, "201": 1, "404": 1, "500": 1, "503": 1 })
  })

  it("aggregates endpoints by method+path with per-endpoint error rate and latency", () => {
    const records = [
      req({ method: "GET", path: "/api/a", status: 200, durationMs: 10 }),
      req({ method: "GET", path: "/api/a", status: 200, durationMs: 20 }),
      req({ method: "GET", path: "/api/a", status: 500, durationMs: 30 }),
      req({ method: "POST", path: "/api/b", status: 200, durationMs: 100 }),
    ]
    const report = aggregateApiUsage(records)
    expect(report.endpointCount).toBe(2)
    const a = report.endpoints.find((e) => e.path === "/api/a")
    expect(a?.count).toBe(3)
    expect(a?.errors).toBe(1)
    expect(a?.errorRate).toBeCloseTo(1 / 3)
    expect(a?.serverErrors).toBe(1)
    expect(a?.latency?.avg).toBe(20)
    expect(a?.latency?.p95).toBe(29)
    // Sorted by count desc.
    expect(report.endpoints[0]?.path).toBe("/api/a")
  })

  it("ranks top users and projects, skipping null ids", () => {
    const records = [
      req({ userId: "user_a", projectId: "proj_1" }),
      req({ userId: "user_a", projectId: "proj_1", status: 500 }),
      req({ userId: "user_b", projectId: null }),
      req({ userId: null, projectId: "proj_2" }),
      req({ userId: null, projectId: null }),
    ]
    const report = aggregateApiUsage(records)
    expect(report.topUsers.map((u) => u.id)).toEqual(["user_a", "user_b"])
    expect(report.topUsers[0]).toMatchObject({ count: 2, errors: 1, errorRate: 0.5, share: 0.4 })
    expect(report.topProjects.map((p) => p.id)).toEqual(["proj_1", "proj_2"])
    expect(report.topProjects[0]?.count).toBe(2)
  })

  it("collects top error messages from error.message then msg fallback", () => {
    const records = [
      req({ status: 500, error: { type: "E", message: "db down" }, msg: "api request" }),
      req({ status: 500, error: { type: "E", message: "db down" } }),
      req({ status: 429, msg: "rate limited" }),
    ]
    const report = aggregateApiUsage(records)
    expect(report.topErrorMessages[0]).toEqual({ message: "db down", count: 2 })
    expect(report.topErrorMessages[1]).toEqual({ message: "rate limited", count: 1 })
  })

  it("computes window and request rate from request timestamps", () => {
    const records = [
      req({ time: "2025-01-01T00:00:00.000Z" }),
      req({ time: "2025-01-01T00:01:00.000Z" }),
      req({ time: "2025-01-01T00:02:00.000Z" }),
      { event: "api.request", method: "GET", path: "/late", status: 200, time: "not-a-date" },
    ]
    const report = aggregateApiUsage(records)
    expect(report.window.first).toBe("2025-01-01T00:00:00.000Z")
    expect(report.window.last).toBe("2025-01-01T00:02:00.000Z")
    expect(report.window.seconds).toBe(120)
    expect(report.totals.perSecond).toBeCloseTo(4 / 120)
  })

  it("respects topN for tables", () => {
    const records = Array.from({ length: 20 }, (_, i) =>
      req({ path: `/api/r${i}`, userId: `u${i}` }),
    )
    const report = aggregateApiUsage(records, { topN: 5 })
    expect(report.endpoints).toHaveLength(5)
    expect(report.endpointCount).toBe(20)
    expect(report.topUsers).toHaveLength(5)
  })

  it("tolerates missing/garbage fields", () => {
    const records = [
      { event: "api.request" },
      { event: "api.request", status: "oops", durationMs: "NaN", method: null, path: undefined },
    ]
    const report = aggregateApiUsage(records)
    expect(report.totals.requests).toBe(2)
    expect(report.statusDistribution["0"]).toBe(2)
    expect(report.latencyMs).toBeNull()
    expect(report.endpoints[0]?.method).toBe("UNKNOWN")
  })
})
