import { describe, expect, it } from "vitest"

import {
  analyzeApiRequests,
  collectRequests,
  isApiRequestRecord,
  normalizeRequest,
  percentile,
} from "./core"
import type { ApiRequestRecord } from "./core"

const T0 = Date.parse("2025-01-01T00:00:00.000Z")
const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

function req(overrides: Partial<ApiRequestRecord> & { at: number }): ApiRequestRecord {
  return {
    event: "api.request",
    time: new Date(overrides.at).toISOString(),
    method: "GET",
    path: "/api/projects",
    status: 200,
    durationMs: 40,
    userId: "user_1",
    projectId: "proj_1",
    ...overrides,
  }
}

describe("isApiRequestRecord / normalizeRequest", () => {
  it("accepts api.request events and rejects everything else", () => {
    expect(isApiRequestRecord({ event: "api.request" })).toBe(true)
    expect(isApiRequestRecord({ event: "db.query" })).toBe(false)
    expect(isApiRequestRecord(null)).toBe(false)
    expect(isApiRequestRecord([1, 2])).toBe(false)
    expect(isApiRequestRecord("api.request")).toBe(false)
  })

  it("normalizes fields and drops records without time/path", () => {
    const n = normalizeRequest(req({ at: T0, userId: null, projectId: null }))
    expect(n).toMatchObject({
      time: T0,
      method: "GET",
      path: "/api/projects",
      status: 200,
      durationMs: 40,
      userId: null,
      projectId: null,
    })
    expect(normalizeRequest({ event: "api.request", path: "/x" })).toBeNull()
    expect(normalizeRequest({ event: "api.request", time: "nope" })).toBeNull()
  })

  it("coerces numeric-string status and duration", () => {
    const n = normalizeRequest(req({ at: T0, status: "503", durationMs: "12.5" }))
    expect(n?.status).toBe(503)
    expect(n?.durationMs).toBe(12.5)
  })
})

describe("percentile", () => {
  it("handles empty, single, and interpolated cases", () => {
    expect(percentile([], 95)).toBeNull()
    expect(percentile([7], 50)).toBe(7)
    expect(percentile([10, 20, 30, 40], 50)).toBe(25)
    expect(percentile([10, 20, 30, 40], 95)).toBeCloseTo(38.5)
  })
})

describe("collectRequests", () => {
  it("filters non-request events and unparseable records", () => {
    const records = [
      req({ at: T0 }),
      { event: "db.query", time: new Date(T0).toISOString() },
      "garbage",
      { event: "api.request" }, // missing time/path
      req({ at: T0 + HOUR, path: "/api/search" }),
    ]
    const requests = collectRequests(records)
    expect(requests).toHaveLength(2)
    expect(requests[1].path).toBe("/api/search")
  })
})

describe("analyzeApiRequests — window + endpoints", () => {
  it("returns an empty report for no requests", () => {
    const report = analyzeApiRequests([{ event: "db.query" }])
    expect(report.window.requests).toBe(0)
    expect(report.endpoints).toEqual([])
    expect(report.anomalies).toEqual([])
  })

  it("aggregates per-endpoint counts, errors, and latency", () => {
    const records = [
      req({ at: T0, durationMs: 10 }),
      req({ at: T0 + HOUR, durationMs: 20 }),
      req({ at: T0 + 2 * HOUR, status: 500, durationMs: 100, path: "/api/projects" }),
      req({ at: T0 + 3 * HOUR, path: "/api/search", method: "POST", durationMs: 5 }),
    ]
    const report = analyzeApiRequests(records)

    expect(report.window.requests).toBe(4)
    expect(report.window.errors).toBe(1)
    expect(report.window.uniqueUsers).toBe(1)

    const projects = report.endpoints.find((e) => e.path === "/api/projects")
    expect(projects).toMatchObject({ requests: 3, errors: 1, method: "GET" })
    expect(projects?.errorRate).toBeCloseTo(1 / 3, 3)
    expect(projects?.avgDurationMs).toBeCloseTo(43.3, 1)

    const search = report.endpoints.find((e) => e.path === "/api/search")
    expect(search?.requests).toBe(1)
    expect(report.endpoints[0].requests).toBeGreaterThanOrEqual(report.endpoints[1].requests)
  })

  it("computes error-budget burn against the configured rate", () => {
    // 10 requests, 2 errors → 20% error rate; budget 10% → burn 2×
    const records = Array.from({ length: 10 }, (_, i) =>
      req({ at: T0 + i * HOUR, status: i < 2 ? 500 : 200 }),
    )
    const report = analyzeApiRequests(records, { errorBudgetRate: 0.1 })
    const ep = report.endpoints[0]
    expect(ep.errorBudget.allowedRate).toBe(0.1)
    expect(ep.errorBudget.burnRate).toBeCloseTo(2, 1)
  })
})

describe("analyzeApiRequests — time series", () => {
  it("buckets requests per endpoint per day", () => {
    const records = [
      req({ at: T0 }),
      req({ at: T0 + HOUR }),
      req({ at: T0 + DAY, status: 404 }),
      req({ at: T0 + DAY, path: "/api/other" }),
    ]
    const report = analyzeApiRequests(records, { bucketMs: DAY })

    const projectsPoints = report.timeSeries.filter((p) => p.endpoint === "GET /api/projects")
    expect(projectsPoints).toHaveLength(2)
    expect(projectsPoints[0]).toMatchObject({ requests: 2, errors: 0 })
    expect(projectsPoints[1]).toMatchObject({ requests: 1, errors: 1 })

    const other = report.timeSeries.find((p) => p.endpoint === "GET /api/other")
    expect(other?.requests).toBe(1)
  })

  it("respects custom bucket widths", () => {
    const records = [req({ at: T0 }), req({ at: T0 + HOUR }), req({ at: T0 + 3 * HOUR })]
    const report = analyzeApiRequests(records, { bucketMs: 2 * HOUR })
    const points = report.timeSeries.filter((p) => p.endpoint === "GET /api/projects")
    expect(points.map((p) => p.requests)).toEqual([2, 1])
  })
})

describe("analyzeApiRequests — top users and projects", () => {
  it("ranks actors by volume and tracks related entities", () => {
    const records = [
      ...Array.from({ length: 5 }, (_, i) =>
        req({ at: T0 + i * HOUR, userId: "user_a", projectId: "proj_x" }),
      ),
      ...Array.from({ length: 3 }, (_, i) =>
        req({ at: T0 + i * HOUR, userId: "user_b", projectId: "proj_y", status: 500 }),
      ),
      req({ at: T0 + 6 * HOUR, userId: null, projectId: null }),
    ]
    const report = analyzeApiRequests(records)

    expect(report.topUsers[0]).toMatchObject({ id: "user_a", requests: 5, errors: 0 })
    expect(report.topUsers[1]).toMatchObject({ id: "user_b", requests: 3, errors: 3 })
    expect(report.topUsers[1].errorRate).toBe(1)
    expect(report.topUsers[2].id).toBe("(anonymous)")

    expect(report.topProjects[0]).toMatchObject({ id: "proj_x", requests: 5, relatedCount: 1 })
    expect(report.topProjects[1]).toMatchObject({ id: "proj_y", requests: 3 })
  })
})

describe("analyzeApiRequests — new vs returning endpoints", () => {
  it("flags endpoints first seen inside the trailing window", () => {
    const last = T0 + 30 * DAY
    const records = [
      // old endpoint seen early and throughout
      req({ at: T0, path: "/api/old" }),
      req({ at: last - HOUR, path: "/api/old" }),
      // brand-new endpoint only near the end
      req({ at: last - HOUR, path: "/api/new" }),
      // endpoint first seen 10 days ago — outside default 7d window
      req({ at: last - 10 * DAY, path: "/api/mid" }),
      req({ at: last - HOUR, path: "/api/mid" }),
    ]
    const report = analyzeApiRequests(records)

    expect(report.newEndpoints).toContain("GET /api/new")
    expect(report.newEndpoints).not.toContain("GET /api/old")
    expect(report.newEndpoints).not.toContain("GET /api/mid")

    const oldEp = report.endpoints.find((e) => e.path === "/api/old")
    expect(oldEp?.isNew).toBe(false)
    const newEp = report.endpoints.find((e) => e.path === "/api/new")
    expect(newEp?.isNew).toBe(true)
  })

  it("respects a custom newEndpointWindowMs", () => {
    const last = T0 + 30 * DAY
    const records = [
      req({ at: last - 10 * DAY, path: "/api/mid" }),
      req({ at: last - HOUR, path: "/api/mid" }),
    ]
    const report = analyzeApiRequests(records, { newEndpointWindowMs: 14 * DAY })
    expect(report.newEndpoints).toContain("GET /api/mid")
  })
})

describe("analyzeApiRequests — anomaly detection", () => {
  it("detects a latency regression in the recent half", () => {
    // Baseline half: 20 requests at ~50ms. Recent half: 20 requests at ~200ms.
    const records: ApiRequestRecord[] = []
    for (let i = 0; i < 20; i++) {
      records.push(req({ at: T0 + i * HOUR, durationMs: 50 }))
      records.push(req({ at: T0 + 10 * DAY + i * HOUR, durationMs: 200 }))
    }
    // Give the window a defined span: baseline occupies first half.
    const report = analyzeApiRequests(records, {
      latencyRegressionFactor: 1.5,
      latencyRegressionMinMs: 25,
    })
    const lat = report.anomalies.find((a) => a.type === "latency_regression")
    expect(lat).toBeDefined()
    expect(lat?.endpoint).toBe("GET /api/projects")
    expect(lat?.baseline.p95Ms).toBeCloseTo(50, 0)
    expect(lat?.recent.p95Ms).toBeCloseTo(200, 0)
  })

  it("does not flag latency when the absolute delta is below the floor", () => {
    const records: ApiRequestRecord[] = []
    for (let i = 0; i < 20; i++) {
      records.push(req({ at: T0 + i * HOUR, durationMs: 10 }))
      records.push(req({ at: T0 + 10 * DAY + i * HOUR, durationMs: 30 }))
    }
    const report = analyzeApiRequests(records, {
      latencyRegressionFactor: 1.5,
      latencyRegressionMinMs: 25, // delta is 20ms < 25ms floor
    })
    expect(report.anomalies.find((a) => a.type === "latency_regression")).toBeUndefined()
  })

  it("detects an error-rate spike in the recent half", () => {
    const records: ApiRequestRecord[] = []
    for (let i = 0; i < 20; i++) {
      // baseline: clean
      records.push(req({ at: T0 + i * HOUR, status: 200 }))
      // recent: 50% errors
      records.push(
        req({
          at: T0 + 10 * DAY + i * HOUR,
          status: i % 2 === 0 ? 500 : 200,
          path: "/api/flaky",
        }),
      )
    }
    const report = analyzeApiRequests(records, { errorSpikeFactor: 3 })
    const spike = report.anomalies.find(
      (a) => a.type === "error_rate_spike" && a.endpoint === "GET /api/flaky",
    )
    expect(spike).toBeDefined()
    expect(spike?.recent.errorRate).toBeCloseTo(0.5, 2)
  })

  it("returns no anomalies for a stable endpoint", () => {
    const records = Array.from({ length: 40 }, (_, i) =>
      req({ at: T0 + i * HOUR, durationMs: 50 + (i % 5), status: i % 20 === 0 ? 500 : 200 }),
    )
    const report = analyzeApiRequests(records)
    expect(report.anomalies).toEqual([])
  })
})
