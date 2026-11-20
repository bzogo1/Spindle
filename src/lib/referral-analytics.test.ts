import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  computeHealthScore,
  getReferralAnalytics,
  REFERRAL_HEALTH_NEUTRAL_SCORE,
  type ReferralAnalyticsTotals,
} from "./referral-analytics"
import {
  flagAttributionFraud,
  getOrCreateReferralCode,
  markRewarded,
  qualifyAttribution,
  recordAttribution,
  rejectAttribution,
  resetReferralProgramStoreForTests,
  updateReferralProgramSettings,
} from "./referral-program"
import { clearReferralFraudStoreForTests } from "./referral-fraud"

/**
 * Helpers build the smallest possible program state through the public
 * store API — the analytics module only reads, so tests drive it via the
 * same functions production code uses.
 */

function makeReferrer(userId: string) {
  return getOrCreateReferralCode(userId)
}

function attribute(
  referrerUserId: string,
  referredUserId: string | null,
  source: "click" | "signup" | "manual" = "signup",
) {
  const code = makeReferrer(referrerUserId)
  const result = recordAttribution({
    code: code.code,
    source,
    referredUserId,
  })
  if (!result.recorded) throw new Error(`attribution failed: ${result.reason}`)
  return result.attribution
}

function qualify(id: string) {
  return qualifyAttribution(id)
}

function reward(id: string) {
  qualify(id)
  return markRewarded(id)
}

function totals(partial: Partial<ReferralAnalyticsTotals>): ReferralAnalyticsTotals {
  return {
    attributions: 0,
    bound: 0,
    pending: 0,
    qualified: 0,
    rewarded: 0,
    rejected: 0,
    fraudFlagged: 0,
    codes: 0,
    ...partial,
  }
}

beforeEach(() => {
  resetReferralProgramStoreForTests()
  clearReferralFraudStoreForTests()
})

afterEach(() => {
  vi.useRealTimers()
})

/* ------------------------------------------------------------------ */
/* Health score                                                         */
/* ------------------------------------------------------------------ */

describe("health score", () => {
  it("returns the documented neutral value for an empty store", () => {
    const report = getReferralAnalytics()
    expect(report.health.score).toBe(REFERRAL_HEALTH_NEUTRAL_SCORE)
    expect(report.health.hasData).toBe(false)
    expect(report.health.components).toEqual({
      activation: null,
      qualification: null,
      reward: null,
      fraudFree: null,
    })
    expect(report.totals.attributions).toBe(0)
  })

  it("computes the documented weighted formula", () => {
    // 2 attributions, both bound; one rewarded, one rejected; no fraud.
    // activation=100, qualification=(0+1)/(0+1+1)=50, reward=1/1=100,
    // fraudFree=100 → 0.2*100 + 0.3*50 + 0.2*100 + 0.3*100 = 85.
    const health = computeHealthScore(
      totals({ attributions: 2, bound: 2, rewarded: 1, rejected: 1 }),
    )
    expect(health.score).toBe(85)
    expect(health.hasData).toBe(true)
    expect(health.components.activation).toBe(100)
    expect(health.components.qualification).toBe(50)
    expect(health.components.reward).toBe(100)
    expect(health.components.fraudFree).toBe(100)
  })

  it("stays within 0–100 across extremes", () => {
    const perfect = computeHealthScore(totals({ attributions: 10, bound: 10, rewarded: 10 }))
    expect(perfect.score).toBe(100)

    const terrible = computeHealthScore(
      totals({
        attributions: 10,
        bound: 0,
        pending: 10,
        fraudFlagged: 10,
        rejected: 0,
      }),
    )
    expect(terrible.score).toBeGreaterThanOrEqual(0)
    expect(terrible.score).toBeLessThan(REFERRAL_HEALTH_NEUTRAL_SCORE)

    // Data exists but nothing decided/qualified → at or below neutral.
    const stagnant = computeHealthScore(totals({ attributions: 5, bound: 5, pending: 5 }))
    expect(stagnant.score).toBeLessThanOrEqual(REFERRAL_HEALTH_NEUTRAL_SCORE)
    expect(stagnant.score).toBeGreaterThanOrEqual(0)
  })

  it("fraud flags reduce the fraudFree component", () => {
    const health = computeHealthScore(
      totals({ attributions: 4, bound: 4, rewarded: 4, fraudFlagged: 1 }),
    )
    expect(health.components.fraudFree).toBe(75)
    expect(health.score).toBeLessThan(100)
  })
})

/* ------------------------------------------------------------------ */
/* Cohorts                                                              */
/* ------------------------------------------------------------------ */

describe("cohorts", () => {
  it("groups attributions by signup month with per-cohort rates", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2025-01-10T12:00:00Z"))
    const a1 = attribute("ref-a", "u-1")
    reward(a1.id)
    attribute("ref-a", "u-2") // stays pending
    const a3 = attribute("ref-b", "u-3")
    qualify(a3.id)

    vi.setSystemTime(new Date("2025-03-05T12:00:00Z"))
    const b1 = attribute("ref-b", "u-4")
    rejectAttribution(b1.id, "window expired")

    const report = getReferralAnalytics({ cohortGranularity: "month" })
    expect(report.cohorts).toHaveLength(2)

    const jan = report.cohorts[0]
    expect(jan.key).toBe("2025-01")
    expect(jan.start).toBe("2025-01-01T00:00:00.000Z")
    expect(jan.total).toBe(3)
    expect(jan.bound).toBe(3)
    expect(jan.rewarded).toBe(1)
    expect(jan.qualified).toBe(1)
    expect(jan.pending).toBe(1)
    // decided = qualified(1) + rewarded(1) + rejected(0) = 2; qual+rew = 2 → 100%
    expect(jan.qualificationRate).toBe(100)
    // rewarded / (qualified + rewarded) = 1/2 = 50%
    expect(jan.rewardRate).toBe(50)

    const mar = report.cohorts[1]
    expect(mar.key).toBe("2025-03")
    expect(mar.total).toBe(1)
    expect(mar.rejected).toBe(1)
    expect(mar.qualificationRate).toBe(0)
  })

  it("supports week granularity with ISO week keys", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2025-01-08T12:00:00Z")) // Wednesday, ISO week 2
    attribute("ref-a", "u-1")
    vi.setSystemTime(new Date("2025-01-20T12:00:00Z")) // Monday, ISO week 4
    attribute("ref-a", "u-2")

    const report = getReferralAnalytics({ cohortGranularity: "week" })
    expect(report.cohorts.map((c) => c.key)).toEqual(["2025-W02", "2025-W04"])
  })

  it("caps cohorts to the most recent N", () => {
    vi.useFakeTimers()
    for (let month = 0; month < 6; month += 1) {
      vi.setSystemTime(new Date(Date.UTC(2025, month, 10, 12)))
      attribute(`ref-${month}`, `u-${month}`)
    }
    const report = getReferralAnalytics({
      cohortGranularity: "month",
      cohortLimit: 3,
    })
    expect(report.cohorts).toHaveLength(3)
    expect(report.cohorts.map((c) => c.key)).toEqual(["2025-04", "2025-05", "2025-06"])
  })
})

/* ------------------------------------------------------------------ */
/* Leaderboard                                                          */
/* ------------------------------------------------------------------ */

describe("leaderboard", () => {
  it("ranks by qualified+rewarded and caps the list", () => {
    // ref-a: 2 rewarded; ref-b: 1 qualified; ref-c: 3 pending clicks.
    reward(attribute("ref-a", "u-a1").id)
    reward(attribute("ref-a", "u-a2").id)
    qualify(attribute("ref-b", "u-b1").id)
    attribute("ref-c", null, "click")
    attribute("ref-c", null, "click")
    attribute("ref-c", null, "click")

    const reportEntries = getReferralAnalytics({ leaderboardLimit: 50 }).leaderboard
    expect(reportEntries.map((e) => e.referrerUserId)).toEqual(["ref-a", "ref-b", "ref-c"])

    const [a, b, c] = reportEntries
    expect(a.rewarded).toBe(2)
    expect(a.conversionRate).toBe(100)
    expect(b.qualified).toBe(1)
    expect(b.rewarded).toBe(0)
    expect(c.clicks).toBe(3)
    expect(c.conversionRate).toBe(0)
  })

  it("respects leaderboardLimit", () => {
    for (let i = 0; i < 5; i += 1) {
      attribute(`ref-${i}`, `u-${i}`)
    }
    const report = getReferralAnalytics({ leaderboardLimit: 2 })
    expect(report.leaderboard).toHaveLength(2)
    // All pending → tie broken by clicks (1 each) then userId asc.
    expect(report.leaderboard.map((e) => e.referrerUserId)).toEqual(["ref-0", "ref-1"])
  })
})

/* ------------------------------------------------------------------ */
/* Economics & fraud exposure                                           */
/* ------------------------------------------------------------------ */

describe("economics", () => {
  it("estimates liability as (pending + qualified) × rewardAmountCents", () => {
    updateReferralProgramSettings({ rewardAmountCents: 500 })
    reward(attribute("ref-a", "u-1").id) // rewarded
    qualify(attribute("ref-b", "u-2").id) // qualified
    attribute("ref-c", "u-3") // pending
    const rejected = attribute("ref-d", "u-4")
    rejectAttribution(rejected.id, "expired")

    const report = getReferralAnalytics()
    expect(report.economics.rewardAmountCents).toBe(500)
    // pending(1) + qualified(1) = 2 → 1000 cents liability
    expect(report.economics.estimatedLiabilityCents).toBe(1000)
    // rewarded(1) → 500 cents granted estimate
    expect(report.economics.grantedCents).toBe(500)
    expect(report.economics.pending).toBe(1)
    expect(report.economics.qualified).toBe(1)
    expect(report.economics.rewarded).toBe(1)
    expect(report.economics.rejected).toBe(1)
  })

  it("reports null liability when no monetary reward is configured", () => {
    const report = getReferralAnalytics()
    expect(report.economics.rewardAmountCents).toBeNull()
    expect(report.economics.estimatedLiabilityCents).toBeNull()
    expect(report.economics.grantedCents).toBeNull()
  })
})

describe("fraud exposure", () => {
  it("counts flagged attributions by status and review-queue totals", () => {
    const pendingFlagged = attribute("ref-a", "u-1")
    flagAttributionFraud(pendingFlagged.id)
    const rewardedFlagged = attribute("ref-b", "u-2")
    reward(rewardedFlagged.id)
    flagAttributionFraud(rewardedFlagged.id)
    attribute("ref-c", "u-3") // clean pending

    updateReferralProgramSettings({ rewardAmountCents: 250 })
    const report = getReferralAnalytics()

    expect(report.fraud.flaggedTotal).toBe(2)
    expect(report.fraud.flaggedRate).toBe(66.7)
    expect(report.fraud.flaggedPending).toBe(1)
    expect(report.fraud.flaggedRewarded).toBe(1)
    // flagged & rewarded → 1 × 250 cents exposure
    expect(report.fraud.flaggedRewardedCents).toBe(250)
    // review queue store is empty (no scanReferrals run)
    expect(report.fraud.reviewQueue).toEqual({
      pending: 0,
      cleared: 0,
      confirmedFraud: 0,
      total: 0,
    })
  })
})

/* ------------------------------------------------------------------ */
/* Period filter & misc                                                  */
/* ------------------------------------------------------------------ */

describe("period filter", () => {
  it("scopes totals to attributions inside the window", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2025-01-01T00:00:00Z"))
    attribute("ref-old", "u-old")

    vi.setSystemTime(new Date("2025-02-20T00:00:00Z"))
    attribute("ref-new", "u-new")

    const all = getReferralAnalytics()
    expect(all.totals.attributions).toBe(2)
    expect(all.period.days).toBeNull()

    const recent = getReferralAnalytics({ periodDays: 30, now: new Date("2025-02-20T00:00:00Z") })
    expect(recent.totals.attributions).toBe(1)
    expect(recent.period.days).toBe(30)
    expect(recent.period.from).toBe("2025-01-21T00:00:00.000Z")
  })
})
