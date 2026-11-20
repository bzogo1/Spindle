import { describe, expect, it } from "vitest"

import type { ContactSubmission } from "@/lib/contact-routing"

import {
  buildContactAnalytics,
  dailySeries,
  queueBreakdown,
  summaryCounts,
} from "./contact-analytics"

type SubmissionLike = Pick<ContactSubmission, "status" | "routedTo" | "topic" | "createdAt">

let seq = 0

function submission(overrides: Partial<SubmissionLike> = {}): SubmissionLike {
  seq += 1
  return {
    status: "new",
    routedTo: "general",
    topic: "general",
    createdAt: `2026-06-${String((seq % 28) + 1).padStart(2, "0")}T12:00:00.000Z`,
    ...overrides,
  }
}

const NOW = Date.UTC(2026, 5, 30, 15, 0, 0) // 2026-06-30T15:00:00Z

describe("summaryCounts", () => {
  it("returns zeros for an empty store", () => {
    expect(summaryCounts([])).toEqual({
      total: 0,
      byStatus: [],
      byQueue: [],
      byTopic: [],
    })
  })

  it("counts totals and breakdowns sorted by count desc", () => {
    const subs = [
      submission({ status: "new", routedTo: "support", topic: "product" }),
      submission({ status: "new", routedTo: "support", topic: "product" }),
      submission({ status: "resolved", routedTo: "billing", topic: "billing" }),
      submission({ status: "spam", routedTo: "general", topic: "other" }),
    ]
    const summary = summaryCounts(subs)

    expect(summary.total).toBe(4)
    expect(summary.byStatus).toEqual([
      { key: "new", count: 2 },
      { key: "resolved", count: 1 },
      { key: "spam", count: 1 },
    ])
    expect(summary.byQueue).toEqual([
      { key: "support", count: 2 },
      { key: "billing", count: 1 },
      { key: "general", count: 1 },
    ])
    expect(summary.byTopic).toEqual([
      { key: "product", count: 2 },
      { key: "billing", count: 1 },
      { key: "other", count: 1 },
    ])
  })

  it("breaks count ties by key ascending", () => {
    const subs = [
      submission({ status: "spam" }),
      submission({ status: "new" }),
      submission({ status: "resolved" }),
    ]
    expect(summaryCounts(subs).byStatus.map((e) => e.key)).toEqual(["new", "resolved", "spam"])
  })
})

describe("queueBreakdown", () => {
  it("returns percents of the total rounded to one decimal", () => {
    const subs = [
      submission({ routedTo: "support" }),
      submission({ routedTo: "support" }),
      submission({ routedTo: "billing" }),
      submission({ routedTo: "billing" }),
      submission({ routedTo: "billing" }),
      submission({ routedTo: "sales" }),
      submission({ routedTo: "sales" }),
      submission({ routedTo: "sales" }),
      submission({ routedTo: "sales" }),
      submission({ routedTo: "general" }), // 10 total
    ]
    expect(queueBreakdown(subs)).toEqual([
      { key: "sales", count: 4, percent: 40 },
      { key: "billing", count: 3, percent: 30 },
      { key: "support", count: 2, percent: 20 },
      { key: "general", count: 1, percent: 10 },
    ])
  })

  it("returns an empty list and zero percents for an empty store", () => {
    expect(queueBreakdown([])).toEqual([])
  })

  it("rounds percents to one decimal", () => {
    const subs = [submission(), submission(), submission({ routedTo: "press" })]
    const breakdown = queueBreakdown(subs)
    const press = breakdown.find((e) => e.key === "press")
    expect(press?.percent).toBe(33.3)
  })
})

describe("dailySeries", () => {
  it("fills zero days across the window ending today (UTC)", () => {
    const series = dailySeries(
      [
        submission({ createdAt: "2026-06-30T01:00:00.000Z" }),
        submission({ createdAt: "2026-06-30T23:59:59.000Z" }),
        submission({ createdAt: "2026-06-28T12:00:00.000Z" }),
      ],
      5,
      NOW,
    )
    expect(series).toHaveLength(5)
    expect(series.map((p) => p.date)).toEqual([
      "2026-06-26",
      "2026-06-27",
      "2026-06-28",
      "2026-06-29",
      "2026-06-30",
    ])
    expect(series.map((p) => p.count)).toEqual([0, 0, 1, 0, 2])
  })

  it("defaults to a 30-day window and clamps days to 1–90", () => {
    expect(dailySeries([], undefined, NOW)).toHaveLength(30)
    expect(dailySeries([], 0, NOW)).toHaveLength(1)
    expect(dailySeries([], -5, NOW)).toHaveLength(1)
    expect(dailySeries([], 500, NOW)).toHaveLength(90)
    expect(dailySeries([], 7.9, NOW)).toHaveLength(7)
  })

  it("ignores submissions outside the window and unparseable dates", () => {
    const series = dailySeries(
      [
        submission({ createdAt: "2020-01-01T00:00:00.000Z" }), // too old
        submission({ createdAt: "not-a-date" }),
        submission({ createdAt: "2026-06-30T00:00:00.000Z" }),
      ],
      3,
      NOW,
    )
    expect(series).toEqual([
      { date: "2026-06-28", count: 0 },
      { date: "2026-06-29", count: 0 },
      { date: "2026-06-30", count: 1 },
    ])
  })

  it("buckets by UTC day regardless of submission order", () => {
    const series = dailySeries(
      [
        submission({ createdAt: "2026-06-29T23:00:00.000Z" }),
        submission({ createdAt: "2026-06-30T01:00:00.000Z" }),
      ],
      2,
      NOW,
    )
    expect(series).toEqual([
      { date: "2026-06-29", count: 1 },
      { date: "2026-06-30", count: 1 },
    ])
  })
})

describe("buildContactAnalytics", () => {
  it("combines summary, queue breakdown, and daily series", () => {
    const subs = [
      submission({
        status: "resolved",
        routedTo: "support",
        topic: "product",
        createdAt: "2026-06-30T10:00:00.000Z",
      }),
      submission({
        status: "new",
        routedTo: "billing",
        topic: "billing",
        createdAt: "2026-06-29T10:00:00.000Z",
      }),
    ]
    const analytics = buildContactAnalytics(subs, { days: 7, now: NOW })

    expect(analytics.days).toBe(7)
    expect(analytics.generatedAt).toBe(new Date(NOW).toISOString())
    expect(analytics.summary.total).toBe(2)
    expect(analytics.queueBreakdown).toEqual([
      { key: "billing", count: 1, percent: 50 },
      { key: "support", count: 1, percent: 50 },
    ])
    expect(analytics.daily).toHaveLength(7)
    expect(analytics.daily.at(-1)).toEqual({ date: "2026-06-30", count: 1 })
    expect(analytics.daily.at(-2)).toEqual({ date: "2026-06-29", count: 1 })
  })

  it("clamps the requested window to 90 days", () => {
    const analytics = buildContactAnalytics([], { days: 365, now: NOW })
    expect(analytics.days).toBe(90)
    expect(analytics.daily).toHaveLength(90)
  })
})
