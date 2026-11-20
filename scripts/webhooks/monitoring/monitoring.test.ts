import { describe, expect, it } from "vitest"

import {
  DEFAULT_THRESHOLDS,
  classifyOutcome,
  demoDeliveryAttempts,
  evaluateAlerts,
  isDeadLettered,
  parseDeliveryAttempt,
  parseDeliveryLog,
  sortAttemptsByTs,
  summarizeDeliveries,
  type DeliveryAttempt,
  type MonitoringThresholds,
} from "./monitoring"

function attempt(partial: Partial<DeliveryAttempt> & { ts: string }): DeliveryAttempt {
  return { ...partial }
}

const T0 = "2026-11-20T04:00:00.000Z"
const at = (seconds: number) => new Date(Date.parse(T0) + seconds * 1000).toISOString()

describe("parseDeliveryAttempt", () => {
  it("parses a canonical log line", () => {
    const parsed = parseDeliveryAttempt({
      ts: T0,
      eventId: "evt_1",
      endpoint: "https://hooks.example.com/x",
      attempt: 2,
      status: 200,
      latencyMs: 123,
    })
    expect(parsed).toEqual({
      ts: T0,
      eventId: "evt_1",
      endpoint: "https://hooks.example.com/x",
      attempt: 2,
      status: 200,
      latencyMs: 123,
    })
  })

  it("accepts field aliases", () => {
    const parsed = parseDeliveryAttempt({
      timestamp: T0,
      event_id: "evt_alias",
      url: "https://hooks.example.com/y",
      attempt_number: "3",
      statusCode: "500",
      duration_ms: "250",
      error_message: "boom",
      dlq: true,
    })
    expect(parsed).toMatchObject({
      ts: T0,
      eventId: "evt_alias",
      endpoint: "https://hooks.example.com/y",
      attempt: 3,
      status: 500,
      latencyMs: 250,
      error: "boom",
      deadLettered: true,
    })
  })

  it("rejects records without a parseable timestamp", () => {
    expect(parseDeliveryAttempt({ status: 200 })).toBeNull()
    expect(parseDeliveryAttempt({ ts: "not-a-date", status: 200 })).toBeNull()
    expect(parseDeliveryAttempt("a string")).toBeNull()
    expect(parseDeliveryAttempt(null)).toBeNull()
    expect(parseDeliveryAttempt([1, 2])).toBeNull()
  })

  it("drops out-of-range status codes", () => {
    expect(parseDeliveryAttempt({ ts: T0, status: 42 })?.status).toBeUndefined()
    expect(parseDeliveryAttempt({ ts: T0, status: 700 })?.status).toBeUndefined()
    expect(parseDeliveryAttempt({ ts: T0, status: 599 })?.status).toBe(599)
  })
})

describe("parseDeliveryLog", () => {
  it("parses NDJSON and counts skipped lines", () => {
    const text = [
      JSON.stringify({ ts: T0, status: 200 }),
      "not json at all",
      JSON.stringify({ ts: at(1), status: 500 }),
      "",
      JSON.stringify({ noTs: true }),
    ].join("\n")
    const { attempts, skippedLines } = parseDeliveryLog(text)
    expect(attempts).toHaveLength(2)
    expect(skippedLines).toBe(2)
  })
})

describe("classifyOutcome", () => {
  it("classifies 2xx as success", () => {
    expect(classifyOutcome(attempt({ ts: T0, status: 200 }))).toBe("success")
    expect(classifyOutcome(attempt({ ts: T0, status: 204 }))).toBe("success")
  })

  it("classifies non-2xx as failure", () => {
    expect(classifyOutcome(attempt({ ts: T0, status: 400 }))).toBe("failure")
    expect(classifyOutcome(attempt({ ts: T0, status: 500 }))).toBe("failure")
    expect(classifyOutcome(attempt({ ts: T0, status: 301 }))).toBe("failure")
  })

  it("classifies missing status as transport error", () => {
    expect(classifyOutcome(attempt({ ts: T0, error: "ETIMEDOUT", latencyMs: 10_000 }))).toBe(
      "error",
    )
  })
})

describe("isDeadLettered", () => {
  it("honors explicit markers", () => {
    expect(isDeadLettered(attempt({ ts: T0, status: 200, deadLettered: true }))).toBe(true)
    expect(isDeadLettered(attempt({ ts: T0, status: 200, deadLettered: false }))).toBe(false)
  })

  it("flags failed attempts at the max-attempt boundary", () => {
    const failed = attempt({ ts: T0, attempt: 5, status: 500 })
    const succeeded = attempt({ ts: T0, attempt: 5, status: 200 })
    expect(isDeadLettered(failed)).toBe(true)
    expect(isDeadLettered(succeeded)).toBe(false)
    expect(isDeadLettered(attempt({ ts: T0, attempt: 4, status: 500 }))).toBe(false)
  })
})

describe("summarizeDeliveries", () => {
  it("computes counts, rates, and window", () => {
    const attempts = [
      attempt({ ts: at(0), status: 200, latencyMs: 100 }),
      attempt({ ts: at(1), status: 200, latencyMs: 200 }),
      attempt({ ts: at(2), status: 500, latencyMs: 300 }),
      attempt({ ts: at(3), error: "ECONNRESET", latencyMs: 50 }),
    ]
    const s = summarizeDeliveries(attempts)
    expect(s.total).toBe(4)
    expect(s.success).toBe(2)
    expect(s.failure).toBe(1)
    expect(s.error).toBe(1)
    expect(s.unhealthyRate).toBeCloseTo(0.5)
    expect(s.successRate).toBeCloseTo(0.5)
    expect(s.window).toEqual({ from: at(0), to: at(3) })
    expect(s.statusCodes).toEqual({ "200": 2, "500": 1, none: 1 })
  })

  it("returns nulls/zeros for an empty input", () => {
    const s = summarizeDeliveries([])
    expect(s.total).toBe(0)
    expect(s.unhealthyRate).toBe(0)
    expect(s.latency.p95Ms).toBeNull()
    expect(s.window).toEqual({ from: null, to: null })
    expect(s.byEndpoint).toEqual([])
  })

  it("computes latency percentiles", () => {
    // 100 samples: latency == index, so p50 ≈ 49.5, p95 ≈ 94.05, p99 ≈ 98.01
    const attempts = Array.from({ length: 100 }, (_, i) =>
      attempt({ ts: at(i), status: 200, latencyMs: i }),
    )
    const s = summarizeDeliveries(attempts)
    expect(s.latency.samples).toBe(100)
    expect(s.latency.p50Ms).toBeCloseTo(49.5, 5)
    expect(s.latency.p95Ms).toBeCloseTo(94.05, 5)
    expect(s.latency.p99Ms).toBeCloseTo(98.01, 5)
    expect(s.latency.maxMs).toBe(99)
    expect(s.latency.avgMs).toBeCloseTo(49.5, 5)
  })

  it("tracks the trailing consecutive-failure streak", () => {
    const attempts = [
      attempt({ ts: at(0), status: 500 }),
      attempt({ ts: at(1), status: 200 }),
      attempt({ ts: at(2), status: 503 }),
      attempt({ ts: at(3), error: "timeout" }),
      attempt({ ts: at(4), status: 502 }),
    ]
    const s = summarizeDeliveries(attempts)
    expect(s.consecutiveFailures).toBe(3)
  })

  it("breaks the streak on a trailing success", () => {
    const attempts = [
      attempt({ ts: at(0), status: 500 }),
      attempt({ ts: at(1), status: 500 }),
      attempt({ ts: at(2), status: 200 }),
    ]
    expect(summarizeDeliveries(attempts).consecutiveFailures).toBe(0)
  })

  it("rolls up per-endpoint stats sorted by unhealthy rate", () => {
    const attempts = [
      attempt({ ts: at(0), endpoint: "https://a", status: 200 }),
      attempt({ ts: at(1), endpoint: "https://a", status: 200 }),
      attempt({ ts: at(2), endpoint: "https://b", status: 500 }),
      attempt({ ts: at(3), endpoint: "https://b", status: 500 }),
      attempt({ ts: at(4), endpoint: "https://c", status: 200, latencyMs: 900 }),
    ]
    const s = summarizeDeliveries(attempts)
    expect(s.byEndpoint.map((e) => e.endpoint)).toEqual(["https://b", "https://a", "https://c"])
    expect(s.byEndpoint[0]).toMatchObject({ total: 2, failure: 2, unhealthyRate: 1 })
    expect(s.byEndpoint[2]?.p50LatencyMs).toBe(900)
  })

  it("detects dead letters via markers and exhausted retries", () => {
    const attempts = [
      attempt({ ts: at(0), eventId: "evt_a", attempt: 5, status: 500 }),
      attempt({ ts: at(1), eventId: "evt_b", attempt: 1, status: 500, deadLettered: true }),
      attempt({ ts: at(2), eventId: "evt_c", attempt: 3, status: 200 }),
    ]
    const s = summarizeDeliveries(attempts)
    expect(s.deadLetter.attempts).toBe(2)
    expect(s.deadLetter.events).toBe(2)
    expect(s.deadLetter.items.map((d) => d.eventId)).toEqual(["evt_a", "evt_b"])
  })

  it("respects a custom maxAttempts for dead-letter inference", () => {
    const attempts = [attempt({ ts: at(0), attempt: 3, status: 500 })]
    expect(summarizeDeliveries(attempts).deadLetter.attempts).toBe(0)
    expect(summarizeDeliveries(attempts, { maxAttempts: 3 }).deadLetter.attempts).toBe(1)
  })
})

describe("sortAttemptsByTs", () => {
  it("orders attempts chronologically without mutating input", () => {
    const input = [
      attempt({ ts: at(2), status: 200 }),
      attempt({ ts: at(0), status: 200 }),
      attempt({ ts: at(1), status: 200 }),
    ]
    const sorted = sortAttemptsByTs(input)
    expect(sorted.map((a) => a.ts)).toEqual([at(0), at(1), at(2)])
    expect(input[0]?.ts).toBe(at(2))
  })
})

describe("evaluateAlerts", () => {
  const thresholds: MonitoringThresholds = { ...DEFAULT_THRESHOLDS, minAttempts: 10 }

  function healthySummary(n = 30) {
    return summarizeDeliveries(
      Array.from({ length: n }, (_, i) => attempt({ ts: at(i), status: 200, latencyMs: 100 })),
    )
  }

  it("returns no alerts for healthy traffic", () => {
    expect(evaluateAlerts(healthySummary(), thresholds)).toEqual([])
  })

  it("suppresses rate alerts below minAttempts", () => {
    // 5 attempts, all failing → unhealthyRate 1.0 but n < minAttempts.
    const summary = summarizeDeliveries(
      Array.from({ length: 5 }, (_, i) => attempt({ ts: at(i), status: 500 })),
    )
    const alerts = evaluateAlerts(summary, thresholds)
    expect(alerts.find((a) => a.rule === "unhealthy-rate")).toBeUndefined()
    // …but the consecutive-failure streak still fires.
    expect(alerts.some((a) => a.rule === "consecutive-failures")).toBe(true)
  })

  it("warns then critically alerts on unhealthy rate", () => {
    const mk = (failures: number, total = 100) =>
      summarizeDeliveries([
        ...Array.from({ length: total - failures }, (_, i) =>
          attempt({ ts: at(i), status: 200, latencyMs: 50 }),
        ),
        ...Array.from({ length: failures }, (_, i) =>
          attempt({ ts: at(total - failures + i), status: 500 }),
        ),
      ])

    const warning = evaluateAlerts(mk(10), thresholds).find((a) => a.rule === "unhealthy-rate")
    expect(warning?.severity).toBe("warning")
    expect(warning?.observed).toBeCloseTo(0.1)

    const critical = evaluateAlerts(mk(30), thresholds).find((a) => a.rule === "unhealthy-rate")
    expect(critical?.severity).toBe("critical")
  })

  it("alerts on p95/p99 latency breaches", () => {
    // 92 fast samples + 8 slow ones → p95 and p99 both land in the slow tail.
    const slow = [3_000, 3_500, 4_000, 5_000, 6_000, 7_000, 8_000, 9_000]
    const attempts = Array.from({ length: 100 }, (_, i) =>
      attempt({
        ts: at(i),
        status: 200,
        latencyMs: i < 92 ? 100 : (slow[i - 92] ?? 9_000),
      }),
    )
    const alerts = evaluateAlerts(summarizeDeliveries(attempts), thresholds)
    expect(alerts.some((a) => a.rule === "latency-p95")).toBe(true)
    expect(alerts.some((a) => a.rule === "latency-p99")).toBe(true)
  })

  it("alerts on dead-lettered deliveries at any volume", () => {
    const summary = summarizeDeliveries([
      attempt({ ts: at(0), status: 200 }),
      attempt({ ts: at(1), eventId: "evt_x", attempt: 5, status: 500 }),
    ])
    const alerts = evaluateAlerts(summary, thresholds)
    const dlq = alerts.find((a) => a.rule === "dead-lettered")
    expect(dlq?.severity).toBe("critical")
    expect(dlq?.observed).toBe(1)
  })

  it("respects a raised deadLetteredMax", () => {
    const summary = summarizeDeliveries([
      attempt({ ts: at(0), status: 200 }),
      attempt({ ts: at(1), eventId: "evt_x", attempt: 5, status: 500 }),
    ])
    const relaxed = { ...thresholds, deadLetteredMax: 5 }
    expect(evaluateAlerts(summary, relaxed).find((a) => a.rule === "dead-lettered")).toBeUndefined()
  })
})

describe("demoDeliveryAttempts", () => {
  it("is deterministic and produces an alertable corpus", () => {
    const a = demoDeliveryAttempts()
    const b = demoDeliveryAttempts()
    expect(a).toEqual(b)
    expect(a.length).toBeGreaterThan(100)

    const summary = summarizeDeliveries(a)
    expect(summary.total).toBe(a.length)
    expect(summary.deadLetter.attempts).toBeGreaterThan(0)
    expect(summary.consecutiveFailures).toBeGreaterThan(0)

    const alerts = evaluateAlerts(summary)
    expect(alerts.some((x) => x.severity === "critical")).toBe(true)
  })
})
