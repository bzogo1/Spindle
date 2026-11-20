import { describe, expect, it } from "vitest"

import {
  BUSINESS_METRIC_CATALOG,
  businessEventSubject,
  computeBusinessMetrics,
  type BusinessEventInput,
  type BusinessUserInput,
} from "./business"

const NOW = Date.parse("2026-01-31T12:00:00.000Z")
const DAY = 24 * 60 * 60 * 1000
const iso = (offsetDays: number, from = NOW) => new Date(from + offsetDays * DAY).toISOString()

function user(id: string, signedUpDaysAgo: number): BusinessUserInput {
  return { id, signedUpAt: iso(-signedUpDaysAgo) }
}

function event(partial: Partial<BusinessEventInput> & { daysAgo?: number }): BusinessEventInput {
  const { daysAgo = 0, ...rest } = partial
  return { timestamp: iso(-daysAgo), ...rest }
}

describe("businessEventSubject", () => {
  it("prefers userId over anonymousId", () => {
    expect(businessEventSubject({ userId: "user:u1", anonymousId: "a1" })).toBe("user:u1")
  })
  it("falls back to anonymousId and prefixes it", () => {
    expect(businessEventSubject({ anonymousId: "a1" })).toBe("anon:a1")
  })
  it("returns null for unattributable events", () => {
    expect(businessEventSubject({})).toBeNull()
    expect(businessEventSubject({ userId: "", anonymousId: null })).toBeNull()
  })
})

describe("computeBusinessMetrics", () => {
  it("returns an empty-but-well-formed report for no data", () => {
    const report = computeBusinessMetrics([], [], { now: NOW })
    expect(report.signups.total).toBe(0)
    expect(report.signups.daily).toHaveLength(30)
    expect(report.activeUsers.dau).toBe(0)
    expect(report.activation.rate).toBeNull()
    expect(report.retentionWeek1.rate).toBeNull()
    expect(report.engagement.eventsPerActiveUser).toBeNull()
    expect(report.conversions.count).toBe(0)
    expect(report.conversions.billingWired).toBe(false)
  })

  it("counts signups per day inside the window", () => {
    const users = [user("u1", 1), user("u2", 1), user("u3", 10), user("old", 400)]
    const report = computeBusinessMetrics(users, [], { now: NOW, windowDays: 30 })
    expect(report.signups.total).toBe(3)
    expect(report.signups.daily.find((d) => d.date === iso(-1).slice(0, 10))?.count).toBe(2)
    expect(report.signups.daily.find((d) => d.date === iso(-10).slice(0, 10))?.count).toBe(1)
  })

  it("computes DAU/WAU from distinct subjects", () => {
    const events = [
      event({ type: "page_view", name: "page_view", userId: "user:u1", daysAgo: 0 }),
      event({ type: "feature_use", feature: "lab", name: "lab", userId: "user:u1", daysAgo: 0 }),
      event({ type: "page_view", name: "page_view", anonymousId: "a1", daysAgo: 3 }),
      event({ type: "page_view", name: "page_view", anonymousId: "a1", daysAgo: 20 }), // outside WAU
      event({ type: "api_call", name: "x", daysAgo: 0 }), // unattributable: totals only
    ]
    const report = computeBusinessMetrics([], events, { now: NOW })
    // DAU: only u1 (anon:a1's in-window hit is 3d old; the 20d one is outside WAU too)
    expect(report.activeUsers.dau).toBe(1)
    expect(report.activeUsers.wau).toBe(2)
    expect(report.activeUsers.mau).toBe(2)
    expect(report.activeUsers.byType.total).toBe(5)
    expect(report.activeUsers.byType.pageViews).toBe(3)
    expect(report.activeUsers.byType.featureUses).toBe(1)
    expect(report.activeUsers.byType.apiCalls).toBe(1)
  })

  it("computes activation: non-page_view event within N days of signup", () => {
    const users = [user("u1", 10), user("u2", 10), user("u3", 2), user("u4", 60)]
    const events = [
      // u1 activated on day 3 (feature_use)
      event({
        type: "feature_use",
        feature: "search",
        name: "search",
        userId: "user:u1",
        daysAgo: 7,
      }),
      // u1 signed up 10d ago → event 7d ago is 3d after signup ✓
      // u2 only page views → not activated
      event({ type: "page_view", name: "page_view", userId: "user:u2", daysAgo: 9 }),
      // u3 too new (2d < 7d window) → not eligible
      event({ type: "feature_use", feature: "lab", name: "lab", userId: "user:u3", daysAgo: 1 }),
      // u4 signed up 60d ago — outside the 30d window → not eligible
      event({ type: "feature_use", feature: "lab", name: "lab", userId: "user:u4", daysAgo: 59 }),
    ]
    const report = computeBusinessMetrics(users, events, { now: NOW, windowDays: 30 })
    expect(report.activation.eligible).toBe(2) // u1, u2
    expect(report.activation.activated).toBe(1)
    expect(report.activation.rate).toBe(0.5)
    expect(report.activation.windowDays).toBe(7)
  })

  it("does not count an activation event after the window", () => {
    const users = [user("u1", 10)]
    const events = [
      // 9 days after signup → outside 7d activation window
      event({ type: "feature_use", feature: "lab", name: "lab", userId: "user:u1", daysAgo: 1 }),
    ]
    const report = computeBusinessMetrics(users, events, { now: NOW })
    expect(report.activation.eligible).toBe(1)
    expect(report.activation.activated).toBe(0)
  })

  it("computes week-1 retention only for the fully-observable cohort", () => {
    // Signup 20d ago: week-1 = days 7–14 after signup = 13–6 days ago — inside window.
    const retained = user("kept", 20)
    const churned = user("gone", 20)
    const tooNew = user("new", 5) // week-1 not fully observed
    const events = [
      event({ type: "page_view", name: "page_view", userId: "user:kept", daysAgo: 10 }), // day 10 after signup
      event({ type: "page_view", name: "page_view", userId: "user:gone", daysAgo: 18 }), // day 2 after signup — not week-1
    ]
    const report = computeBusinessMetrics([retained, churned, tooNew], events, {
      now: NOW,
      windowDays: 30,
    })
    expect(report.retentionWeek1.cohort).toBe(2)
    expect(report.retentionWeek1.retained).toBe(1)
    expect(report.retentionWeek1.rate).toBe(0.5)
  })

  it("excludes retention cohort whose week-1 predates the window", () => {
    // Signed up 60d ago → week-1 ended 46d ago, before a 30d window.
    const report = computeBusinessMetrics([user("ancient", 60)], [], {
      now: NOW,
      windowDays: 30,
    })
    expect(report.retentionWeek1.cohort).toBe(0)
    expect(report.retentionWeek1.rate).toBeNull()
  })

  it("ranks top features by unique subjects", () => {
    const events = [
      event({ type: "feature_use", feature: "lab", name: "lab", userId: "user:u1", daysAgo: 1 }),
      event({ type: "feature_use", feature: "lab", name: "lab", userId: "user:u1", daysAgo: 2 }),
      event({ type: "feature_use", feature: "lab", name: "lab", userId: "user:u2", daysAgo: 1 }),
      event({
        type: "feature_use",
        feature: "search",
        name: "search",
        userId: "user:u1",
        daysAgo: 1,
      }),
      event({
        type: "page_view",
        name: "page_view",
        feature: "ignored",
        userId: "user:u1",
        daysAgo: 1,
      }),
    ]
    const report = computeBusinessMetrics([], events, { now: NOW })
    expect(report.topFeatures[0]).toEqual({ feature: "lab", events: 3, subjects: 2 })
    expect(report.topFeatures[1]).toEqual({ feature: "search", events: 1, subjects: 1 })
    expect(report.topFeatures).toHaveLength(2)
  })

  it("counts conversion-proxy events and rate vs signups", () => {
    const users = [user("u1", 5), user("u2", 5)]
    const events = [
      event({ type: "feature_use", name: "checkout_completed", userId: "user:u1", daysAgo: 1 }),
      event({ type: "feature_use", name: "checkout_completed", userId: "user:u1", daysAgo: 2 }),
    ]
    const report = computeBusinessMetrics(users, events, { now: NOW })
    expect(report.conversions.count).toBe(2)
    expect(report.conversions.rate).toBe(1) // 2 events / 2 signups — proxy, not unique users
    expect(report.conversions.matchedNames).toEqual(["checkout_completed"])
  })

  it("computes engagement per active subject", () => {
    const events = [
      event({ type: "page_view", name: "page_view", userId: "user:u1", daysAgo: 0 }),
      event({ type: "feature_use", feature: "lab", name: "lab", userId: "user:u1", daysAgo: 0 }),
      event({ type: "page_view", name: "page_view", userId: "user:u2", daysAgo: 0 }),
      event({ name: "mystery", daysAgo: 0 }), // no subject, no type → feature_use, totals only
    ]
    const report = computeBusinessMetrics([], events, { now: NOW })
    expect(report.engagement.activeSubjects).toBe(2)
    expect(report.engagement.events).toBe(4)
    expect(report.engagement.eventsPerActiveUser).toBe(2)
  })

  it("skips malformed inputs instead of throwing", () => {
    const report = computeBusinessMetrics(
      [
        { id: "", signedUpAt: iso(-1) },
        { id: "u1", signedUpAt: "not-a-date" },
        { id: "u2", signedUpAt: iso(-1) },
      ],
      [
        { type: "page_view", timestamp: "garbage" },
        { type: "page_view", timestamp: iso(-1), userId: "user:u2" },
      ],
      { now: NOW },
    )
    expect(report.signups.total).toBe(1)
    expect(report.activeUsers.mau).toBe(1)
  })

  it("clamps the window to 1–365 days", () => {
    expect(computeBusinessMetrics([], [], { now: NOW, windowDays: 0 }).windowDays).toBe(1)
    expect(computeBusinessMetrics([], [], { now: NOW, windowDays: 9999 }).windowDays).toBe(365)
  })
})

describe("BUSINESS_METRIC_CATALOG", () => {
  it("documents every computed section and marks conversions unavailable", () => {
    const ids = BUSINESS_METRIC_CATALOG.map((m) => m.id)
    for (const id of [
      "signups",
      "active_users",
      "activation",
      "retention_week1",
      "engagement",
      "feature_adoption",
      "conversions",
    ]) {
      expect(ids).toContain(id)
    }
    const conversions = BUSINESS_METRIC_CATALOG.find((m) => m.id === "conversions")!
    expect(conversions.available).toBe(false)
    for (const metric of BUSINESS_METRIC_CATALOG) {
      expect(metric.definition.length).toBeGreaterThan(10)
      expect(metric.source.length).toBeGreaterThan(3)
    }
  })
})
