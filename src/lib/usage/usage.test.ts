import { describe, expect, it } from "vitest"

import {
  computeAdoptionRates,
  computeDailyActiveUsers,
  computeUsageTotals,
  countFeatureUsage,
  createFeatureUsageEvent,
  filterEventsByWindow,
  parseFeatureUsageEvent,
  parseFeatureUsageEventLine,
  summarizeUsage,
  utcDayStart,
} from "./index"

const T0 = Date.UTC(2025, 0, 10, 12, 0, 0) // 2025-01-10T12:00:00Z
const DAY = 24 * 60 * 60 * 1000

function ev(
  feature: string,
  subject: string,
  timestamp: number,
  properties?: Record<string, unknown>,
) {
  const event = createFeatureUsageEvent({ feature, subject, timestamp, properties })
  expect(event).not.toBeNull()
  return event!
}

describe("createFeatureUsageEvent", () => {
  it("builds a canonical event with defaults", () => {
    const before = Date.now()
    const event = createFeatureUsageEvent({
      feature: "new-dashboard",
      subject: "user:u1",
    })
    expect(event).toMatchObject({
      kind: "feature_use",
      feature: "new-dashboard",
      subject: "user:u1",
    })
    expect(event!.timestamp).toBeGreaterThanOrEqual(before)
  })

  it("accepts mock:<email> subjects from mock auth", () => {
    const event = createFeatureUsageEvent({
      feature: "automations",
      subject: "mock:dev@example.com",
      timestamp: T0,
    })
    expect(event).toMatchObject({ subject: "mock:dev@example.com" })
  })

  it("rejects invalid feature keys, subjects, and timestamps", () => {
    expect(createFeatureUsageEvent({ feature: "", subject: "user:u1" })).toBeNull()
    expect(createFeatureUsageEvent({ feature: "has space", subject: "user:u1" })).toBeNull()
    expect(createFeatureUsageEvent({ feature: "f", subject: "not-a-subject" })).toBeNull()
    expect(createFeatureUsageEvent({ feature: "f", subject: "user:u1", timestamp: NaN })).toBeNull()
    expect(
      createFeatureUsageEvent({ feature: "f", subject: "user:u1", kind: "page_view" }),
    ).toBeNull()
  })

  it("drops unserialisable or oversized properties", () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular
    expect(
      createFeatureUsageEvent({
        feature: "f",
        subject: "user:u1",
        properties: circular,
      }),
    ).not.toBeNull()
    const event = createFeatureUsageEvent({
      feature: "f",
      subject: "user:u1",
      properties: circular,
    })!
    expect(event.properties).toBeUndefined()

    const big = createFeatureUsageEvent({
      feature: "f",
      subject: "user:u1",
      properties: { blob: "x".repeat(10_000) },
    })!
    expect(big.properties).toBeUndefined()
  })
})

describe("parseFeatureUsageEvent / parseFeatureUsageEventLine", () => {
  it("accepts the canonical shape", () => {
    const event = parseFeatureUsageEvent({
      kind: "feature_use",
      feature: "docs-search",
      subject: "anon:abc",
      timestamp: T0,
      properties: { source: "header" },
    })
    expect(event).toMatchObject({ feature: "docs-search", subject: "anon:abc" })
  })

  it("accepts mock:<email> subjects in the canonical shape", () => {
    const event = parseFeatureUsageEvent({
      kind: "feature_use",
      feature: "automations",
      subject: "mock:dev@example.com",
      timestamp: T0,
    })
    expect(event).toMatchObject({ subject: "mock:dev@example.com" })
  })

  it("accepts the flattened /api/analytics ingest shape", () => {
    const event = parseFeatureUsageEvent({
      type: "feature_use",
      name: "ignored",
      feature: "collab-cursors",
      anonymousId: "uuid-123",
      props: { panel: "editor" },
      timestamp: T0,
    })
    expect(event).toMatchObject({
      feature: "collab-cursors",
      subject: "anon:uuid-123",
      properties: { panel: "editor" },
    })
  })

  it("rejects other event types and malformed input", () => {
    expect(
      parseFeatureUsageEvent({ kind: "page_view", feature: "f", subject: "user:u", timestamp: T0 }),
    ).toBeNull()
    expect(parseFeatureUsageEvent(null)).toBeNull()
    expect(parseFeatureUsageEvent("nope")).toBeNull()
    expect(
      parseFeatureUsageEvent({ kind: "feature_use", feature: "f", subject: "user:u" }),
    ).toBeNull()
  })

  it("parses JSONL lines and skips blanks/malformed lines", () => {
    const line = JSON.stringify({
      kind: "feature_use",
      feature: "f",
      subject: "user:u1",
      timestamp: T0,
    })
    expect(parseFeatureUsageEventLine(line)?.feature).toBe("f")
    expect(parseFeatureUsageEventLine("")).toBeNull()
    expect(parseFeatureUsageEventLine("   ")).toBeNull()
    expect(parseFeatureUsageEventLine("{not json")).toBeNull()
    expect(parseFeatureUsageEventLine('{"kind":"other"}')).toBeNull()
  })
})

describe("countFeatureUsage", () => {
  it("counts events and unique subjects per feature, sorted", () => {
    const events = [
      ev("alpha", "user:u1", T0),
      ev("alpha", "user:u2", T0 + 1),
      ev("alpha", "user:u1", T0 + 2), // repeat subject
      ev("beta", "user:u1", T0),
      ev("beta", "anon:a1", T0),
    ]
    expect(countFeatureUsage(events)).toEqual([
      { feature: "alpha", events: 3, uniqueSubjects: 2 },
      { feature: "beta", events: 2, uniqueSubjects: 2 },
    ])
  })

  it("returns [] for no events", () => {
    expect(countFeatureUsage([])).toEqual([])
  })
})

describe("computeAdoptionRates", () => {
  const events = [ev("alpha", "user:u1", T0), ev("alpha", "user:u2", T0), ev("beta", "user:u1", T0)]

  it("uses distinct subjects in the set as the default denominator", () => {
    const rates = computeAdoptionRates(events)
    expect(rates.find((r) => r.feature === "alpha")!.adoption).toBe(1) // 2/2
    expect(rates.find((r) => r.feature === "beta")!.adoption).toBe(0.5) // 1/2
  })

  it("uses an explicit totalSubjects denominator", () => {
    const rates = computeAdoptionRates(events, 10)
    expect(rates.find((r) => r.feature === "alpha")!.adoption).toBeCloseTo(0.2)
    expect(rates.find((r) => r.feature === "beta")!.adoption).toBeCloseTo(0.1)
  })

  it("returns adoption 0 for an empty universe", () => {
    expect(computeAdoptionRates([], 5)).toEqual([])
    const [rate] = computeAdoptionRates(events, 0)
    expect(rate.adoption).toBe(0)
  })
})

describe("computeDailyActiveUsers", () => {
  it("groups distinct subjects per feature per UTC day", () => {
    const events = [
      ev("alpha", "user:u1", T0), // Jan 10
      ev("alpha", "user:u1", T0 + DAY), // Jan 11, same subject new day
      ev("alpha", "user:u2", T0 + DAY),
      ev("alpha", "user:u1", T0 + DAY + 1),
      ev("beta", "user:u1", T0),
    ]
    const dau = computeDailyActiveUsers(events)
    expect(dau).toEqual([
      { date: "2025-01-10", feature: "alpha", activeSubjects: 1, events: 1 },
      { date: "2025-01-10", feature: "beta", activeSubjects: 1, events: 1 },
      { date: "2025-01-11", feature: "alpha", activeSubjects: 2, events: 3 },
    ])
  })

  it("buckets by UTC day boundary, not local time", () => {
    const justBeforeMidnight = Date.UTC(2025, 0, 10, 23, 59, 59)
    const justAfter = Date.UTC(2025, 0, 11, 0, 0, 1)
    const dau = computeDailyActiveUsers([
      ev("f", "user:u1", justBeforeMidnight),
      ev("f", "user:u1", justAfter),
    ])
    expect(dau.map((d) => d.date)).toEqual(["2025-01-10", "2025-01-11"])
  })
})

describe("computeUsageTotals / summarizeUsage", () => {
  it("computes totals across the set", () => {
    const events = [ev("a", "user:u1", T0), ev("b", "anon:x", T0), ev("a", "user:u2", T0)]
    expect(computeUsageTotals(events)).toEqual({
      events: 3,
      uniqueSubjects: 3,
      features: 2,
    })
  })

  it("summarizes counts, adoption, and DAU together", () => {
    const events = [ev("a", "user:u1", T0), ev("a", "user:u2", T0 + DAY)]
    const summary = summarizeUsage(events)
    expect(summary.totals).toEqual({ events: 2, uniqueSubjects: 2, features: 1 })
    expect(summary.byFeature).toEqual([{ feature: "a", events: 2, uniqueSubjects: 2 }])
    expect(summary.adoption[0].adoption).toBe(1)
    expect(summary.dailyActiveUsers).toHaveLength(2)
  })
})

describe("filterEventsByWindow / utcDayStart", () => {
  it("filters [start, end) inclusive of start, exclusive of end", () => {
    const events = [ev("f", "user:u1", T0), ev("f", "user:u1", T0 + DAY)]
    expect(filterEventsByWindow(events, T0, T0 + DAY)).toHaveLength(1)
    expect(filterEventsByWindow(events, T0, T0 + DAY + 1)).toHaveLength(2)
  })

  it("utcDayStart returns midnight UTC", () => {
    expect(utcDayStart(T0)).toBe(Date.UTC(2025, 0, 10))
    expect(utcDayStart(T0, 1)).toBe(Date.UTC(2025, 0, 9))
  })
})
