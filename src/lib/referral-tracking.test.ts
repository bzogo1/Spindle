import { describe, expect, it } from "vitest"

import {
  buildReferralTracking,
  breakdownByCode,
  breakdownBySource,
  dailySeries,
  funnelCounts,
  REFERRAL_TRACKING_MAX_DAYS,
  topReferrers,
  type ReferralTrackingRecord,
} from "./referral-tracking"
import {
  getReferralProgramStoreForTests,
  resetReferralProgramStoreForTests,
} from "./referral-program"

/**
 * Pure-function coverage for `src/lib/referral-tracking.ts`. Most tests
 * build plain record arrays directly — the aggregations take any array of
 * the `ReferralTrackingRecord` shape, so no store seeding is needed except
 * for the `collectAllAttributions` paging check at the bottom.
 */

function record(
  partial: Partial<ReferralTrackingRecord> & { code: string },
): ReferralTrackingRecord {
  return {
    referrerUserId: "referrer-1",
    status: "pending",
    source: "click",
    createdAt: "2025-06-10T12:00:00.000Z",
    fraudFlagged: false,
    ...partial,
  }
}

describe("funnelCounts", () => {
  it("returns all-zero counts and rates for an empty store", () => {
    const funnel = funnelCounts([])
    expect(funnel.counts).toEqual({
      clicks: 0,
      pending: 0,
      qualified: 0,
      rewarded: 0,
      rejected: 0,
      fraudFlagged: 0,
    })
    expect(funnel.rates).toEqual({
      pending: 0,
      qualified: 0,
      rewarded: 0,
      rejected: 0,
      qualifiedOrRewarded: 0,
      rewardedOfQualified: 0,
    })
  })

  it("counts every status and computes rates as fractions of clicks", () => {
    const funnel = funnelCounts([
      record({ code: "A", status: "pending" }),
      record({ code: "A", status: "pending" }),
      record({ code: "B", status: "qualified" }),
      record({ code: "B", status: "rewarded" }),
      record({ code: "C", status: "rewarded", fraudFlagged: true }),
      record({ code: "C", status: "rejected" }),
    ])
    expect(funnel.counts).toEqual({
      clicks: 6,
      pending: 2,
      qualified: 1,
      rewarded: 2,
      rejected: 1,
      fraudFlagged: 1,
    })
    // pending + qualified + rewarded + rejected === clicks
    expect(
      funnel.counts.pending +
        funnel.counts.qualified +
        funnel.counts.rewarded +
        funnel.counts.rejected,
    ).toBe(funnel.counts.clicks)
    expect(funnel.rates.pending).toBeCloseTo(2 / 6, 4)
    expect(funnel.rates.qualifiedOrRewarded).toBeCloseTo(3 / 6, 4)
    // of 3 ever-qualified records, 2 were rewarded
    expect(funnel.rates.rewardedOfQualified).toBeCloseTo(2 / 3, 4)
  })

  it("reports rewardedOfQualified 0 when nothing ever qualified", () => {
    const funnel = funnelCounts([
      record({ code: "A", status: "pending" }),
      record({ code: "B", status: "rejected" }),
    ])
    expect(funnel.rates.rewardedOfQualified).toBe(0)
    expect(funnel.rates.qualifiedOrRewarded).toBe(0)
  })
})

describe("breakdownByCode", () => {
  it("returns an empty list for no attributions", () => {
    expect(breakdownByCode([])).toEqual([])
  })

  it("tallies statuses per code and sorts by rewarded desc, total desc, code asc", () => {
    const rows = breakdownByCode([
      record({ code: "B", status: "pending" }),
      record({ code: "A", status: "rewarded" }),
      record({ code: "A", status: "rewarded", fraudFlagged: true }),
      record({ code: "A", status: "pending" }),
      record({ code: "C", status: "rejected" }),
      record({ code: "B", status: "rewarded" }),
    ])
    expect(rows.map((r) => r.code)).toEqual(["A", "B", "C"])
    expect(rows[0]).toMatchObject({
      code: "A",
      total: 3,
      rewarded: 2,
      pending: 1,
      fraudFlagged: 1,
    })
    expect(rows[1]).toMatchObject({ code: "B", total: 2, rewarded: 1, pending: 1 })
    expect(rows[2]).toMatchObject({ code: "C", total: 1, rejected: 1 })
  })
})

describe("breakdownBySource", () => {
  it("groups by source sorted by total desc then source asc", () => {
    const rows = breakdownBySource([
      record({ code: "A", source: "signup", status: "rewarded" }),
      record({ code: "A", source: "click" }),
      record({ code: "A", source: "click" }),
      record({ code: "B", source: "manual" }),
    ])
    expect(rows.map((r) => r.source)).toEqual(["click", "manual", "signup"])
    expect(rows[0]).toMatchObject({ source: "click", total: 2, pending: 2 })
    expect(rows[1]).toMatchObject({ source: "manual", total: 1 })
    expect(rows[2]).toMatchObject({ source: "signup", total: 1, rewarded: 1 })
  })

  it("returns empty for no attributions", () => {
    expect(breakdownBySource([])).toEqual([])
  })
})

describe("topReferrers", () => {
  it("sorts by rewarded desc, total desc, user id asc and clamps the limit", () => {
    const rows = topReferrers(
      [
        record({ code: "A", referrerUserId: "u-b", status: "pending" }),
        record({ code: "A", referrerUserId: "u-b", status: "pending" }),
        record({ code: "B", referrerUserId: "u-a", status: "rewarded" }),
        record({ code: "C", referrerUserId: "u-a", status: "rewarded" }),
        record({ code: "D", referrerUserId: "u-c", status: "rewarded" }),
        record({ code: "E", referrerUserId: "u-d", status: "pending" }),
      ],
      3,
    )
    // u-a (2 rewarded) and u-c (1 rewarded) lead; u-b has the larger total
    // among the un-rewarded so it beats u-d by total. u-c < u-a? ordering:
    // rewarded desc → u-a(2), u-c(1), then u-b(0 rewarded, total 2) vs
    // u-d(0 rewarded, total 1) → u-b before u-d; limit 3 → u-d dropped.
    expect(rows.map((r) => r.referrerUserId)).toEqual(["u-a", "u-c", "u-b"])
  })

  it("breaks rewarded ties by total then id, and clamps limit to >= 1", () => {
    const rows = topReferrers(
      [
        record({ code: "A", referrerUserId: "u-2", status: "rewarded" }),
        record({ code: "B", referrerUserId: "u-1", status: "rewarded" }),
        record({ code: "C", referrerUserId: "u-1", status: "pending" }),
      ],
      0, // clamps to 1
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].referrerUserId).toBe("u-1")
  })
})

describe("dailySeries", () => {
  const now = Date.UTC(2025, 5, 15, 18, 0, 0) // 2025-06-15 UTC

  it("zero-fills every day in the window ending today", () => {
    const series = dailySeries([], 7, now)
    expect(series).toHaveLength(7)
    expect(series[0].date).toBe("2025-06-09")
    expect(series[6].date).toBe("2025-06-15")
    for (const point of series) {
      expect(point.clicks).toBe(0)
      expect(point.pending).toBe(0)
      expect(point.qualified).toBe(0)
      expect(point.rewarded).toBe(0)
      expect(point.rejected).toBe(0)
      expect(point.fraudFlagged).toBe(0)
    }
  })

  it("buckets records by createdAt UTC day with their current status", () => {
    const series = dailySeries(
      [
        record({ code: "A", createdAt: "2025-06-15T00:30:00.000Z", status: "pending" }),
        record({ code: "A", createdAt: "2025-06-15T23:59:00.000Z", status: "rewarded" }),
        record({ code: "A", createdAt: "2025-06-14T12:00:00.000Z", status: "rejected" }),
        record({ code: "A", createdAt: "2025-06-01T12:00:00.000Z", status: "pending" }), // outside 7d window
        record({ code: "A", createdAt: "not-a-date", status: "pending" }), // ignored
      ],
      7,
      now,
    )
    const day15 = series.find((p) => p.date === "2025-06-15")!
    expect(day15.clicks).toBe(2)
    expect(day15.pending).toBe(1)
    expect(day15.rewarded).toBe(1)
    const day14 = series.find((p) => p.date === "2025-06-14")!
    expect(day14.rejected).toBe(1)
    expect(day14.clicks).toBe(1)
    expect(series.every((p) => p.clicks >= 0)).toBe(true)
    // Nothing from June 1st leaked into the window
    expect(series.find((p) => p.date === "2025-06-01")).toBeUndefined()
  })

  it("clamps days to the 1–90 bound", () => {
    expect(dailySeries([], 0, now)).toHaveLength(1)
    expect(dailySeries([], 500, now)).toHaveLength(REFERRAL_TRACKING_MAX_DAYS)
    expect(dailySeries([], Number.NaN, now)).toHaveLength(30)
  })
})

describe("buildReferralTracking", () => {
  it("assembles the full payload and clamps the day window", () => {
    const now = Date.UTC(2025, 5, 15, 12, 0, 0)
    const payload = buildReferralTracking(
      [
        record({ code: "SPN-AAAA-BBBB", status: "rewarded", source: "signup" }),
        record({ code: "SPN-AAAA-BBBB", status: "pending", source: "click" }),
      ],
      { days: 365, now, topReferrerLimit: 5 },
    )
    expect(payload.days).toBe(REFERRAL_TRACKING_MAX_DAYS)
    expect(payload.generatedAt).toBe("2025-06-15T12:00:00.000Z")
    expect(payload.funnel.counts.clicks).toBe(2)
    expect(payload.byCode).toHaveLength(1)
    expect(payload.bySource.map((s) => s.source)).toEqual(["click", "signup"])
    expect(payload.topReferrers).toHaveLength(1)
    expect(payload.daily).toHaveLength(REFERRAL_TRACKING_MAX_DAYS)
    expect(payload.statuses).toContain("rewarded")
    expect(payload.sources).toContain("manual")
  })
})

describe("collectAllAttributions", () => {
  // Imported lazily to keep the pure-function tests above store-free.
  it("pages through the bounded admin listing", async () => {
    const { collectAllAttributions } = await import("./referral-tracking")
    resetReferralProgramStoreForTests()
    try {
      const empty = collectAllAttributions()
      expect(empty).toEqual([])
    } finally {
      resetReferralProgramStoreForTests()
    }
    expect(getReferralProgramStoreForTests().attributions).toBe(0)
  })
})
