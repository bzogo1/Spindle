import { beforeEach, describe, expect, it } from "vitest"

import {
  flagAttributionFraud,
  getAttribution,
  getOrCreateReferralCode,
  getReferralProgramStoreForTests,
  qualifyAttribution,
  recordAttribution,
  rejectAttribution,
  resetReferralProgramStoreForTests,
  updateReferralProgramSettings,
} from "@/lib/referral-program"
import {
  getReferralRewardsStoreForTests,
  getReward,
  getRewardForAttribution,
  issuePendingReward,
  issueRewardForAttribution,
  listRewardsForAdmin,
  listRewardsForUser,
  REFERRAL_REWARDS_STORE_MAX,
  REFERRAL_REWARD_TYPES,
  resetReferralRewardsStoreForTests,
  rewardJson,
  rewardLabel,
  rewardStats,
  revokeReward,
  ReferralRewardError,
} from "./referral-rewards"

beforeEach(() => {
  resetReferralRewardsStoreForTests()
  resetReferralProgramStoreForTests()
})

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** Records + qualifies an attribution for `referrer`'s code. */
function qualifiedAttribution(referrerUserId = "referrer-1") {
  const code = getOrCreateReferralCode(referrerUserId)
  const result = recordAttribution({
    code: code.code,
    source: "manual",
    referredUserId: null,
  })
  if (!result.recorded) throw new Error(`attribution not recorded: ${result.reason}`)
  return qualifyAttribution(result.attribution.id)
}

function expectRewardError(fn: () => unknown, code: ReferralRewardError["code"]) {
  try {
    fn()
  } catch (error) {
    expect(error).toBeInstanceOf(ReferralRewardError)
    expect((error as ReferralRewardError).code).toBe(code)
    return
  }
  throw new Error(`Expected ReferralRewardError(${code})`)
}

/* ------------------------------------------------------------------ */
/* Issuance rules                                                      */
/* ------------------------------------------------------------------ */

describe("issueRewardForAttribution", () => {
  it("issues a reward for a qualified attribution and marks it rewarded", () => {
    const attribution = qualifiedAttribution()
    const reward = issueRewardForAttribution(attribution.id, { reason: "  qualified signup  " })

    expect(reward.status).toBe("issued")
    expect(reward.type).toBe("credit")
    expect(reward.attributionId).toBe(attribution.id)
    expect(reward.referrerUserId).toBe("referrer-1")
    expect(reward.amountCents).toBeNull() // program default rewardAmountCents
    expect(reward.reason).toBe("qualified signup")
    expect(reward.issuedAt).toBeTruthy()
    expect(reward.revokedAt).toBeUndefined()
    expect(reward.id).toMatch(/^rfr_/)

    // The attribution advanced qualified → rewarded in the same call.
    expect(getAttribution(attribution.id)?.status).toBe("rewarded")
  })

  it("rejects a pending attribution (must qualify first)", () => {
    const code = getOrCreateReferralCode("referrer-1")
    const result = recordAttribution({ code: code.code, source: "manual" })
    if (!result.recorded) throw new Error("record failed")

    expectRewardError(() => issueRewardForAttribution(result.attribution.id), "invalid_transition")
  })

  it("rejects a rejected attribution", () => {
    const attribution = qualifiedAttribution()
    rejectAttribution(attribution.id, "fraud confirmed")
    expectRewardError(() => issueRewardForAttribution(attribution.id), "invalid_transition")
  })

  it("rejects a fraud-flagged attribution", () => {
    const attribution = qualifiedAttribution()
    flagAttributionFraud(attribution.id)
    expectRewardError(() => issueRewardForAttribution(attribution.id), "fraud_flagged")
    // Nothing was recorded.
    expect(getRewardForAttribution(attribution.id)).toBeUndefined()
  })

  it("honours the options.fraudFlagged override seam", () => {
    const attribution = qualifiedAttribution()
    expectRewardError(
      () => issueRewardForAttribution(attribution.id, { fraudFlagged: true }),
      "fraud_flagged",
    )
  })

  it("prevents double-issue for the same attribution", () => {
    const attribution = qualifiedAttribution()
    const first = issueRewardForAttribution(attribution.id)
    expectRewardError(() => issueRewardForAttribution(attribution.id), "conflict")
    expect(getRewardForAttribution(attribution.id)?.id).toBe(first.id)
    expect(listRewardsForAdmin().total).toBe(1)
  })

  it("returns not_found for an unknown attribution id", () => {
    expectRewardError(() => issueRewardForAttribution("rfa_missing"), "not_found")
    expectRewardError(() => issueRewardForAttribution("   "), "invalid")
  })

  it("defaults amountCents from program settings and accepts overrides", () => {
    updateReferralProgramSettings({ rewardAmountCents: 1999 })
    const a = qualifiedAttribution()
    const b = qualifiedAttribution("referrer-2")

    const defaulted = issueRewardForAttribution(a.id)
    expect(defaulted.amountCents).toBe(1999)

    const explicit = issueRewardForAttribution(b.id, {
      type: "badge",
      amountCents: null,
      reason: "badge award",
    })
    expect(explicit.type).toBe("badge")
    expect(explicit.amountCents).toBeNull()
    expect(explicit.reason).toBe("badge award")
  })

  it("accepts every declared reward type", () => {
    for (const type of REFERRAL_REWARD_TYPES) {
      const attribution = qualifiedAttribution(`referrer-${type}`)
      const reward = issueRewardForAttribution(attribution.id, { type })
      expect(reward.type).toBe(type)
    }
  })

  it("rejects an invalid reward type and invalid amounts", () => {
    const attribution = qualifiedAttribution()
    expectRewardError(
      () => issueRewardForAttribution(attribution.id, { type: "cash" as never }),
      "invalid",
    )
    expectRewardError(
      () => issueRewardForAttribution(attribution.id, { amountCents: -5 }),
      "invalid",
    )
    expectRewardError(
      () => issueRewardForAttribution(attribution.id, { amountCents: 1.5 }),
      "invalid",
    )
  })

  it("aborts issuance when maxRewardsPerUser is reached (no orphan record)", () => {
    updateReferralProgramSettings({ maxRewardsPerUser: 1 })
    const first = qualifiedAttribution()
    issueRewardForAttribution(first.id)

    const second = qualifiedAttribution()
    // markRewarded's cap failure surfaces as ReferralProgramError("limit").
    try {
      issueRewardForAttribution(second.id)
      throw new Error("expected limit error")
    } catch (error) {
      expect(error).not.toBeInstanceOf(ReferralRewardError)
      expect((error as { code?: string }).code).toBe("limit")
    }
    // The failed issuance left no reward and kept the attribution qualified.
    expect(getRewardForAttribution(second.id)).toBeUndefined()
  })

  it("can re-issue after a reward-store reset when the attribution is already rewarded", () => {
    const attribution = qualifiedAttribution()
    const first = issueRewardForAttribution(attribution.id)
    resetReferralRewardsStoreForTests()

    const second = issueRewardForAttribution(attribution.id)
    expect(second.id).not.toBe(first.id)
    expect(second.status).toBe("issued")
    expect(second.attributionId).toBe(attribution.id)
  })

  it("syncAttribution:false issues without touching the attribution", () => {
    const attribution = qualifiedAttribution()
    const reward = issueRewardForAttribution(attribution.id, { syncAttribution: false })
    expect(reward.status).toBe("issued")
    expect(getAttribution(attribution.id)?.status).toBe("qualified")
  })
})

/* ------------------------------------------------------------------ */
/* Revocation                                                          */
/* ------------------------------------------------------------------ */

describe("revokeReward", () => {
  it("revokes an issued reward, stamps revokedAt and stores the reason", () => {
    const attribution = qualifiedAttribution()
    const reward = issueRewardForAttribution(attribution.id)
    const revoked = revokeReward(reward.id, "  fraud confirmed after issue  ")

    expect(revoked.status).toBe("revoked")
    expect(revoked.revokedAt).toBeTruthy()
    expect(revoked.reason).toBe("fraud confirmed after issue")
    expect(getReward(reward.id)?.status).toBe("revoked")
  })

  it("revoked is terminal — a second revoke and an issue transition both fail", () => {
    const attribution = qualifiedAttribution()
    const reward = issueRewardForAttribution(attribution.id)
    revokeReward(reward.id)

    expectRewardError(() => revokeReward(reward.id), "invalid_transition")
    expectRewardError(() => issuePendingReward(reward.id), "invalid_transition")
  })

  it("issuePendingReward rejects an already-issued reward", () => {
    const attribution = qualifiedAttribution()
    const reward = issueRewardForAttribution(attribution.id)
    expectRewardError(() => issuePendingReward(reward.id), "invalid_transition")
  })

  it("throws not_found for unknown ids", () => {
    expectRewardError(() => revokeReward("rfr_missing"), "not_found")
    expectRewardError(() => issuePendingReward("rfr_missing"), "not_found")
    expect(getReward("rfr_missing")).toBeUndefined()
    expect(getRewardForAttribution("rfa_missing")).toBeUndefined()
  })

  it("clawback is final: attribution stays rewarded, cap slot consumed, re-issue conflicts", () => {
    const attribution = qualifiedAttribution()
    const reward = issueRewardForAttribution(attribution.id)
    revokeReward(reward.id, "fraud confirmed")

    // No un-reward transition exists — the attribution stays "rewarded".
    expect(getAttribution(attribution.id)?.status).toBe("rewarded")

    // Re-issuing for the same attribution is a conflict (tombstoned).
    expectRewardError(() => issueRewardForAttribution(attribution.id), "conflict")
    expect(getRewardForAttribution(attribution.id)?.status).toBe("revoked")
  })
})

/* ------------------------------------------------------------------ */
/* Listings + stats                                                    */
/* ------------------------------------------------------------------ */

describe("listings and stats", () => {
  function seedRewards() {
    const a1 = qualifiedAttribution("referrer-a")
    const a2 = qualifiedAttribution("referrer-a")
    const b1 = qualifiedAttribution("referrer-b")
    const r1 = issueRewardForAttribution(a1.id, { type: "credit" })
    const r2 = issueRewardForAttribution(a2.id, { type: "badge" })
    const r3 = issueRewardForAttribution(b1.id, { type: "credit" })
    revokeReward(r2.id, "clawed back")
    return { r1, r2, r3 }
  }

  it("listRewardsForUser returns only that referrer's rewards", () => {
    const { r1, r2, r3 } = seedRewards()
    const mine = listRewardsForUser("referrer-a")
    expect(mine.total).toBe(2)
    expect(mine.items.map((r) => r.id).sort()).toEqual([r1.id, r2.id].sort())
    expect(listRewardsForUser("referrer-b").items.map((r) => r.id)).toEqual([r3.id])
    expect(listRewardsForUser("nobody")).toEqual({ items: [], total: 0 })
    expect(listRewardsForUser("   ")).toEqual({ items: [], total: 0 })
  })

  it("listRewardsForUser honours status/type/attributionId filters and pagination", () => {
    const { r1, r2 } = seedRewards()
    const a1attribution = r1.attributionId

    expect(listRewardsForUser("referrer-a", { status: "issued" }).items.map((r) => r.id)).toEqual([
      r1.id,
    ])
    expect(listRewardsForUser("referrer-a", { status: "revoked" }).items.map((r) => r.id)).toEqual([
      r2.id,
    ])
    expect(listRewardsForUser("referrer-a", { type: "badge" }).items.map((r) => r.id)).toEqual([
      r2.id,
    ])
    expect(
      listRewardsForUser("referrer-a", { attributionId: a1attribution }).items.map((r) => r.id),
    ).toEqual([r1.id])

    const page = listRewardsForUser("referrer-a", { limit: 1, offset: 1 })
    expect(page.items).toHaveLength(1)
    expect(page.total).toBe(2)
    // limit is clamped to [1, 500]
    expect(listRewardsForUser("referrer-a", { limit: 0 }).items.length).toBeGreaterThanOrEqual(1)
    expect(listRewardsForUser("referrer-a", { limit: 9999 }).items).toHaveLength(2)
  })

  it("listRewardsForAdmin filters across every referrer", () => {
    const { r1, r2, r3 } = seedRewards()
    const all = listRewardsForAdmin()
    expect(all.total).toBe(3)

    expect(listRewardsForAdmin({ referrerUserId: "referrer-b" }).items.map((r) => r.id)).toEqual([
      r3.id,
    ])
    expect(listRewardsForAdmin({ status: "revoked" }).items.map((r) => r.id)).toEqual([r2.id])
    expect(listRewardsForAdmin({ type: "badge" }).items.map((r) => r.id)).toEqual([r2.id])
    expect(listRewardsForAdmin({ attributionId: r1.attributionId }).items.map((r) => r.id)).toEqual(
      [r1.id],
    )
    expect(listRewardsForAdmin({ limit: 2, offset: 2 }).items).toHaveLength(1)
  })

  it("rewardStats counts statuses and types, scoped or global", () => {
    seedRewards()
    const global = rewardStats()
    expect(global.total).toBe(3)
    expect(global.issued).toBe(2)
    expect(global.revoked).toBe(1)
    expect(global.pending).toBe(0)
    expect(global.byType).toEqual({ credit: 2, badge: 1, trial_extension: 0 })

    const scoped = rewardStats({ referrerUserId: "referrer-a" })
    expect(scoped.total).toBe(2)
    expect(scoped.revoked).toBe(1)

    const filtered = rewardStats({ status: "issued", type: "credit" })
    expect(filtered.total).toBe(2) // r1 + r3 are issued credits; r2 is a revoked badge
    expect(filtered.issued).toBe(2)
    expect(filtered.byType.badge).toBe(0)
  })

  it("rewardJson returns a JSON-safe view", () => {
    const attribution = qualifiedAttribution()
    const reward = issueRewardForAttribution(attribution.id, { amountCents: 500 })
    const view = rewardJson(reward)
    expect(view).toMatchObject({
      id: reward.id,
      attributionId: attribution.id,
      referrerUserId: "referrer-1",
      type: "credit",
      status: "issued",
      amountCents: 500,
      reason: "",
    })
    expect(view.issuedAt).toBeTruthy()
    expect(view.revokedAt).toBeNull()
    expect(() => JSON.stringify(view)).not.toThrow()
  })

  it("rewardLabel surfaces the program reward label", () => {
    expect(rewardLabel()).toBe("A free month of Spindle Pro")
    updateReferralProgramSettings({ rewardLabel: "Swag box" })
    expect(rewardLabel()).toBe("Swag box")
  })
})

/* ------------------------------------------------------------------ */
/* Bounds + reset                                                      */
/* ------------------------------------------------------------------ */

describe("store bounds and reset", () => {
  it("caps the ledger at REFERRAL_REWARDS_STORE_MAX and reports store size", () => {
    const code = getOrCreateReferralCode("bulk-referrer")
    for (let i = 0; i < REFERRAL_REWARDS_STORE_MAX; i += 1) {
      const result = recordAttribution({ code: code.code, source: "manual" })
      if (!result.recorded) throw new Error("record failed")
      qualifyAttribution(result.attribution.id)
      issueRewardForAttribution(result.attribution.id, { syncAttribution: false })
    }
    expect(getReferralRewardsStoreForTests().rewards).toBe(REFERRAL_REWARDS_STORE_MAX)

    // A store full of issued rewards refuses new issuance.
    const extra = recordAttribution({ code: code.code, source: "manual" })
    if (!extra.recorded) throw new Error("record failed")
    qualifyAttribution(extra.attribution.id)
    expectRewardError(
      () => issueRewardForAttribution(extra.attribution.id, { syncAttribution: false }),
      "limit",
    )

    // Ordering regression: with syncAttribution enabled the capacity
    // check must run BEFORE markRewarded — a "limit" failure must not
    // advance the attribution to "rewarded" (consuming a
    // maxRewardsPerUser slot) with no reward record behind it.
    const extraSynced = recordAttribution({ code: code.code, source: "manual" })
    if (!extraSynced.recorded) throw new Error("record failed")
    qualifyAttribution(extraSynced.attribution.id)
    expectRewardError(() => issueRewardForAttribution(extraSynced.attribution.id), "limit")
    expect(getAttribution(extraSynced.attribution.id)?.status).toBe("qualified")
    expect(getRewardForAttribution(extraSynced.attribution.id)).toBeUndefined()

    // Revoking one frees capacity — the oldest revoked record is evicted.
    const oldest = listRewardsForAdmin({ limit: 1, offset: REFERRAL_REWARDS_STORE_MAX - 1 })
      .items[0]
    const oldestAttributionId = oldest.attributionId
    revokeReward(oldest.id)
    const issued = issueRewardForAttribution(extra.attribution.id, { syncAttribution: false })
    expect(issued.status).toBe("issued")
    expect(getReferralRewardsStoreForTests().rewards).toBe(REFERRAL_REWARDS_STORE_MAX)

    // Tombstone: the evicted revoked record's attribution index entry is
    // gone, yet re-issuing for it still conflicts — clawback is final.
    expect(getRewardForAttribution(oldestAttributionId)).toBeUndefined()
    expectRewardError(
      () => issueRewardForAttribution(oldestAttributionId, { syncAttribution: false }),
      "conflict",
    )
  }, 60_000)

  it("resetReferralRewardsStoreForTests clears the ledger only", () => {
    const attribution = qualifiedAttribution()
    issueRewardForAttribution(attribution.id)
    resetReferralRewardsStoreForTests()
    expect(listRewardsForAdmin().total).toBe(0)
    // Program store is untouched — the attribution is still "rewarded".
    expect(getReferralProgramStoreForTests().attributions).toBe(1)
  })
})
