import { beforeEach, describe, expect, it } from "vitest"

import {
  flagAttributionFraud,
  getAttribution,
  getOrCreateReferralCode,
  getReferralCodeByCode,
  getReferralCodeForUser,
  getReferralProgramSettings,
  getReferralProgramStats,
  getReferralProgramStoreForTests,
  getReferralStatsForUser,
  isReferralAttributionStatus,
  markRewarded,
  qualifyAttribution,
  recordAttribution,
  REFERRAL_ATTRIBUTIONS_STORE_MAX,
  REFERRAL_CODES_STORE_MAX,
  REFERRAL_PROGRAM_DEFAULTS,
  REFERRAL_ATTRIBUTION_STATUSES,
  rejectAttribution,
  resetReferralProgramStoreForTests,
  setVanityReferralCode,
  updateReferralProgramSettings,
} from "./referral-program"
import { REFERRAL_CODE_PATTERN, isAnyReferralCode } from "@/lib/referral"

beforeEach(() => {
  resetReferralProgramStoreForTests()
})

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

describe("program settings", () => {
  it("returns validated defaults", () => {
    const settings = getReferralProgramSettings()
    expect(settings).toEqual(REFERRAL_PROGRAM_DEFAULTS)
    expect(settings.enabled).toBe(true)
    expect(settings.rewardAmountCents).toBeNull()
  })

  it("applies a partial update and keeps untouched fields", () => {
    const updated = updateReferralProgramSettings({
      enabled: false,
      rewardLabel: "  Two months free  ",
      rewardAmountCents: 1999,
      maxRewardsPerUser: 3,
      windowDays: 14,
    })
    expect(updated).toEqual({
      enabled: false,
      rewardLabel: "Two months free",
      rewardAmountCents: 1999,
      maxRewardsPerUser: 3,
      windowDays: 14,
    })
    // Returned object is a copy — mutating it must not corrupt the store.
    updated.enabled = true
    expect(getReferralProgramSettings().enabled).toBe(false)
  })

  it("rejects invalid settings atomically", () => {
    expect(() => updateReferralProgramSettings({ rewardLabel: "   " })).toThrowError(/rewardLabel/)
    expect(() => updateReferralProgramSettings({ rewardLabel: "x".repeat(201) })).toThrowError(
      /rewardLabel/,
    )
    expect(() => updateReferralProgramSettings({ rewardAmountCents: -1 })).toThrowError(
      /rewardAmountCents/,
    )
    expect(() => updateReferralProgramSettings({ rewardAmountCents: 1.5 })).toThrowError(
      /rewardAmountCents/,
    )
    expect(() => updateReferralProgramSettings({ maxRewardsPerUser: 0 })).toThrowError(
      /maxRewardsPerUser/,
    )
    expect(() => updateReferralProgramSettings({ maxRewardsPerUser: 1.5 })).toThrowError(
      /maxRewardsPerUser/,
    )
    expect(() => updateReferralProgramSettings({ windowDays: 0 })).toThrowError(/windowDays/)
    expect(() => updateReferralProgramSettings({ windowDays: 3651 })).toThrowError(/windowDays/)
    // Failed patches leave the previous settings intact.
    expect(getReferralProgramSettings()).toEqual(REFERRAL_PROGRAM_DEFAULTS)
  })

  it("reset restores defaults", () => {
    updateReferralProgramSettings({ enabled: false, rewardLabel: "Nope" })
    resetReferralProgramStoreForTests()
    expect(getReferralProgramSettings()).toEqual(REFERRAL_PROGRAM_DEFAULTS)
  })
})

/* ------------------------------------------------------------------ */
/* Codes                                                               */
/* ------------------------------------------------------------------ */

describe("referral codes", () => {
  it("generates a pattern-valid SPN-XXXX-XXXX code once per user", () => {
    const first = getOrCreateReferralCode("user-1")
    expect(first.code).toMatch(REFERRAL_CODE_PATTERN)
    expect(first.vanity).toBe(false)
    expect(first.userId).toBe("user-1")

    const second = getOrCreateReferralCode("user-1")
    expect(second.id).toBe(first.id)
    expect(second.code).toBe(first.code)
  })

  it("issues distinct codes to distinct users", () => {
    const a = getOrCreateReferralCode("user-a")
    const b = getOrCreateReferralCode("user-b")
    expect(a.code).not.toBe(b.code)
    expect(getReferralCodeForUser("user-a")?.code).toBe(a.code)
    expect(getReferralCodeForUser("user-b")?.code).toBe(b.code)
  })

  it("looks codes up by canonical string, case-insensitively", () => {
    const record = getOrCreateReferralCode("user-1")
    expect(getReferralCodeByCode(record.code.toLowerCase())?.id).toBe(record.id)
    expect(getReferralCodeByCode("  " + record.code + "  ")?.id).toBe(record.id)
    expect(getReferralCodeByCode("SPN-NOPE-0000")).toBeNull()
    expect(getReferralCodeByCode("not-a-code")).toBeNull()
  })

  it("rejects an empty user id", () => {
    expect(() => getOrCreateReferralCode("   ")).toThrowError(/user id/)
  })

  it("sets a vanity code, normalizing case and prefix", () => {
    const record = getOrCreateReferralCode("user-1")
    const generated = record.code

    const upgraded = setVanityReferralCode("user-1", "  bogdan-lab  ")
    expect(upgraded.code).toBe("SPN-BOGDAN-LAB")
    expect(upgraded.vanity).toBe(true)
    expect(upgraded.id).toBe(record.id)
    expect(isAnyReferralCode(upgraded.code)).toBe(true)

    // The old generated code is freed.
    expect(getReferralCodeByCode(generated)).toBeNull()
    expect(getReferralCodeByCode("SPN-BOGDAN-LAB")?.userId).toBe("user-1")
  })

  it("accepts vanity input with the SPN- prefix", () => {
    setVanityReferralCode("user-1", "spn-my-handle")
    expect(getReferralCodeForUser("user-1")?.code).toBe("SPN-MY-HANDLE")
  })

  it("rejects invalid vanity codes", () => {
    getOrCreateReferralCode("user-1")
    for (const bad of ["", "ab", "x".repeat(21), "-lead", "trail-", "has space"]) {
      expect(() => setVanityReferralCode("user-1", bad)).toThrowError(/Vanity code/)
    }
    // Slugs that reproduce the generated SPN-XXXX-XXXX shape are rejected.
    expect(() => setVanityReferralCode("user-1", "SPN-ABCD-EFGH")).toThrowError(/Vanity code/)
    // Code unchanged after failures.
    expect(getReferralCodeForUser("user-1")?.vanity).toBe(false)
  })

  it("enforces vanity uniqueness across users", () => {
    getOrCreateReferralCode("user-1")
    getOrCreateReferralCode("user-2")
    setVanityReferralCode("user-1", "SPN-EARLY-BIRD")

    expect(() => setVanityReferralCode("user-2", "early-bird")).toThrowError(/already taken/)
    expect(() => setVanityReferralCode("user-2", "SPN-EARLY-BIRD")).toThrowError(/already taken/)
    // Same user re-setting their own vanity is fine.
    expect(setVanityReferralCode("user-1", "SPN-EARLY-BIRD").code).toBe("SPN-EARLY-BIRD")
  })

  it("a user's second vanity frees the first for others", () => {
    getOrCreateReferralCode("user-1")
    getOrCreateReferralCode("user-2")
    setVanityReferralCode("user-1", "SPN-FIRST-TRY")
    setVanityReferralCode("user-1", "SPN-SECOND-TRY")
    expect(getReferralCodeByCode("SPN-FIRST-TRY")).toBeNull()
    expect(() => setVanityReferralCode("user-2", "first-try")).not.toThrow()
    expect(getReferralCodeForUser("user-2")?.code).toBe("SPN-FIRST-TRY")
  })
})

/* ------------------------------------------------------------------ */
/* Attribution recording                                               */
/* ------------------------------------------------------------------ */

describe("recordAttribution", () => {
  function seed() {
    const referrer = getOrCreateReferralCode("referrer-1")
    return referrer
  }

  it("records an anonymous click for a known code", () => {
    const code = seed()
    const result = recordAttribution({ code: code.code, source: "click" })
    expect(result.recorded).toBe(true)
    if (!result.recorded) return
    expect(result.attribution.status).toBe("pending")
    expect(result.attribution.referredUserId).toBeNull()
    expect(result.attribution.referrerUserId).toBe("referrer-1")
    expect(result.attribution.code).toBe(code.code)
    expect(result.attribution.source).toBe("click")
  })

  it("normalizes the code before lookup", () => {
    const code = seed()
    const result = recordAttribution({ code: `  ${code.code.toLowerCase()}  `, source: "signup" })
    expect(result.recorded).toBe(true)
  })

  it("rejects unknown and malformed codes", () => {
    seed()
    expect(recordAttribution({ code: "SPN-NOPE-0000", source: "click" })).toEqual({
      recorded: false,
      reason: "unknown_code",
    })
    expect(recordAttribution({ code: "garbage", source: "click" })).toEqual({
      recorded: false,
      reason: "unknown_code",
    })
  })

  it("records nothing when the program is disabled", () => {
    const code = seed()
    updateReferralProgramSettings({ enabled: false })
    expect(recordAttribution({ code: code.code, source: "click" })).toEqual({
      recorded: false,
      reason: "disabled",
    })
    expect(getReferralProgramStoreForTests().attributions).toBe(0)
  })

  it("rejects self-referral", () => {
    const code = seed()
    const result = recordAttribution({
      code: code.code,
      source: "signup",
      referredUserId: "referrer-1",
    })
    expect(result).toEqual({ recorded: false, reason: "self_referral" })
    expect(getReferralProgramStoreForTests().attributions).toBe(0)
  })

  it("rejects a second attribution for the same referred user", () => {
    const code = seed()
    const first = recordAttribution({
      code: code.code,
      source: "signup",
      referredUserId: "referred-1",
    })
    expect(first.recorded).toBe(true)

    // Same user via a different code still dedupes on referredUserId.
    const other = getOrCreateReferralCode("referrer-2")
    const dupe = recordAttribution({
      code: other.code,
      source: "signup",
      referredUserId: "referred-1",
    })
    expect(dupe).toEqual({ recorded: false, reason: "duplicate" })

    // Anonymous clicks are never deduplicated.
    expect(recordAttribution({ code: code.code, source: "click" }).recorded).toBe(true)
    expect(recordAttribution({ code: code.code, source: "click" }).recorded).toBe(true)
  })

  it("runs the optional fraud check and flags the record", () => {
    const code = seed()
    const flagged = recordAttribution({
      code: code.code,
      source: "signup",
      referredUserId: "referred-1",
      fraudCheck: (record) => record.referredUserId === "referred-1",
    })
    expect(flagged.recorded).toBe(true)
    if (!flagged.recorded) return
    expect(flagged.attribution.fraudFlagged).toBe(true)

    const clean = recordAttribution({
      code: code.code,
      source: "signup",
      referredUserId: "referred-2",
      fraudCheck: () => false,
    })
    expect(clean.recorded).toBe(true)
    if (!clean.recorded) return
    expect(clean.attribution.fraudFlagged).toBeUndefined()
  })

  it("attributes signups to the code owner even after a vanity upgrade", () => {
    const code = seed()
    const generatedCode = code.code // record is mutated by the vanity upgrade
    recordAttribution({ code: generatedCode, source: "click" })
    setVanityReferralCode("referrer-1", "SPN-LATE-BLOOMER")
    // Old code no longer resolves.
    expect(recordAttribution({ code: generatedCode, source: "click" })).toEqual({
      recorded: false,
      reason: "unknown_code",
    })
    const viaVanity = recordAttribution({
      code: "SPN-LATE-BLOOMER",
      source: "signup",
      referredUserId: "referred-9",
    })
    expect(viaVanity.recorded).toBe(true)
    if (!viaVanity.recorded) return
    expect(viaVanity.attribution.referrerUserId).toBe("referrer-1")
    expect(viaVanity.attribution.code).toBe("SPN-LATE-BLOOMER")
  })
})

/* ------------------------------------------------------------------ */
/* State machine                                                       */
/* ------------------------------------------------------------------ */

describe("attribution state machine", () => {
  function pendingAttribution(userId = "referred-x") {
    const code = getOrCreateReferralCode("referrer-1")
    const result = recordAttribution({
      code: code.code,
      source: "signup",
      referredUserId: userId,
    })
    if (!result.recorded) throw new Error("expected recorded attribution")
    return result.attribution
  }

  it("walks pending → qualified → rewarded", () => {
    const attribution = pendingAttribution()

    const qualified = qualifyAttribution(attribution.id)
    expect(qualified.status).toBe("qualified")
    expect(qualified.qualifiedAt).toBeTruthy()

    const rewarded = markRewarded(attribution.id)
    expect(rewarded.status).toBe("rewarded")
    expect(rewarded.rewardedAt).toBeTruthy()
    expect(getAttribution(attribution.id)?.status).toBe("rewarded")
  })

  it("rejects illegal transitions", () => {
    const attribution = pendingAttribution()

    // Cannot reward straight from pending.
    expect(() => markRewarded(attribution.id)).toThrowError(/Cannot reward/)
    // Cannot qualify twice.
    qualifyAttribution(attribution.id)
    expect(() => qualifyAttribution(attribution.id)).toThrowError(/Cannot qualify/)
    // Rewarded is terminal.
    markRewarded(attribution.id)
    expect(() => qualifyAttribution(attribution.id)).toThrowError(/Cannot qualify/)
    expect(() => rejectAttribution(attribution.id)).toThrowError(/Cannot reject/)
    expect(() => markRewarded(attribution.id)).toThrowError(/Cannot reward/)
  })

  it("rejects from pending and qualified with a reason", () => {
    const a = pendingAttribution("referred-a")
    const rejected = rejectAttribution(a.id, "  fraud confirmed  ")
    expect(rejected.status).toBe("rejected")
    expect(rejected.rejectedReason).toBe("fraud confirmed")

    const b = pendingAttribution("referred-b")
    qualifyAttribution(b.id)
    expect(rejectAttribution(b.id).status).toBe("rejected")
    // Rejected is terminal.
    expect(() => qualifyAttribution(b.id)).toThrowError(/Cannot qualify/)
  })

  it("throws not_found for unknown ids", () => {
    expect(() => qualifyAttribution("rfa_missing")).toThrowError(/not found/i)
    expect(() => markRewarded("rfa_missing")).toThrowError(/not found/i)
    expect(() => rejectAttribution("rfa_missing")).toThrowError(/not found/i)
  })

  it("enforces maxRewardsPerUser on markRewarded", () => {
    updateReferralProgramSettings({ maxRewardsPerUser: 2 })
    const code = getOrCreateReferralCode("referrer-1")

    const ids: string[] = []
    for (const user of ["u1", "u2", "u3"]) {
      const result = recordAttribution({
        code: code.code,
        source: "signup",
        referredUserId: user,
      })
      if (result.recorded) ids.push(result.attribution.id)
    }
    for (const id of ids.slice(0, 2)) {
      qualifyAttribution(id)
      markRewarded(id)
    }

    // Third reward exceeds the cap — stays qualified.
    qualifyAttribution(ids[2])
    expect(() => markRewarded(ids[2])).toThrowError(/maximum of 2/)
    expect(getAttribution(ids[2])?.status).toBe("qualified")
  })

  it("validates the transition before enforcing the reward cap", () => {
    updateReferralProgramSettings({ maxRewardsPerUser: 1 })
    const code = getOrCreateReferralCode("referrer-1")

    // Fill the cap: one rewarded attribution for this referrer.
    const rewarded = recordAttribution({
      code: code.code,
      source: "signup",
      referredUserId: "u-cap",
    })
    if (!rewarded.recorded) throw new Error("expected recorded attribution")
    qualifyAttribution(rewarded.attribution.id)
    markRewarded(rewarded.attribution.id)

    // A terminal (rejected) record for the same capped referrer must report
    // invalid_transition, not "limit" — the state check runs first.
    const dead = recordAttribution({
      code: code.code,
      source: "signup",
      referredUserId: "u-dead",
    })
    if (!dead.recorded) throw new Error("expected recorded attribution")
    rejectAttribution(dead.attribution.id)
    expect(() => markRewarded(dead.attribution.id)).toThrowError(/Cannot reward/)

    // Same for a still-pending record (also cannot transition to rewarded).
    const pending = recordAttribution({
      code: code.code,
      source: "signup",
      referredUserId: "u-pending",
    })
    if (!pending.recorded) throw new Error("expected recorded attribution")
    expect(() => markRewarded(pending.attribution.id)).toThrowError(/Cannot reward/)

    // And a qualified record past the cap still gets the cap error.
    const overCap = recordAttribution({
      code: code.code,
      source: "signup",
      referredUserId: "u-over",
    })
    if (!overCap.recorded) throw new Error("expected recorded attribution")
    qualifyAttribution(overCap.attribution.id)
    expect(() => markRewarded(overCap.attribution.id)).toThrowError(/maximum of 1/)
    expect(getAttribution(overCap.attribution.id)?.status).toBe("qualified")
  })

  it("flagAttributionFraud marks without changing status", () => {
    const attribution = pendingAttribution()
    const flagged = flagAttributionFraud(attribution.id)
    expect(flagged?.fraudFlagged).toBe(true)
    expect(flagged?.status).toBe("pending")
    expect(flagAttributionFraud("rfa_missing")).toBeUndefined()
    // Idempotent.
    expect(flagAttributionFraud(attribution.id)?.fraudFlagged).toBe(true)
  })
})

/* ------------------------------------------------------------------ */
/* Stats                                                               */
/* ------------------------------------------------------------------ */

describe("stats", () => {
  it("counts per-user attributions by status", () => {
    const code = getOrCreateReferralCode("referrer-1")
    const results = ["a", "b", "c"].map((user) =>
      recordAttribution({ code: code.code, source: "signup", referredUserId: `u-${user}` }),
    )
    const ids = results.flatMap((r) => (r.recorded ? [r.attribution.id] : []))
    // One anonymous click too.
    recordAttribution({ code: code.code, source: "click" })

    qualifyAttribution(ids[0])
    qualifyAttribution(ids[1])
    markRewarded(ids[1])
    rejectAttribution(ids[2])
    flagAttributionFraud(ids[0])

    const stats = getReferralStatsForUser("referrer-1")
    expect(stats.clicks).toBe(4)
    // ids[0] qualified+flagged, ids[1] rewarded, ids[2] rejected, and the
    // anonymous click is still pending.
    expect(stats.qualified).toBe(1)
    expect(stats.rewarded).toBe(1)
    expect(stats.rejected).toBe(1)
    expect(stats.pending).toBe(1)
    expect(stats.fraudFlagged).toBe(1)

    expect(getReferralStatsForUser("nobody").clicks).toBe(0)
    expect(getReferralStatsForUser("  ").clicks).toBe(0)
  })

  it("reports program-wide totals and per-user scope", () => {
    const a = getOrCreateReferralCode("ref-a")
    const b = getOrCreateReferralCode("ref-b")
    recordAttribution({ code: a.code, source: "click" })
    recordAttribution({ code: a.code, source: "signup", referredUserId: "u-1" })
    recordAttribution({ code: b.code, source: "signup", referredUserId: "u-2" })
    getOrCreateReferralCode("ref-c") // code with no attributions

    const stats = getReferralProgramStats("ref-a")
    expect(stats.clicks).toBe(2)
    expect(stats.pending).toBe(2)
    expect(stats.codes).toBe(3)
    expect(stats.totals.clicks).toBe(3)
    expect(stats.totals.pending).toBe(3)
    expect(stats.totals.codes).toBe(3)

    const noUser = getReferralProgramStats()
    expect(noUser.clicks).toBe(0)
    expect(noUser.totals.clicks).toBe(3)
  })
})

/* ------------------------------------------------------------------ */
/* Bounds                                                              */
/* ------------------------------------------------------------------ */

describe("store bounds", () => {
  it("evicts the oldest attribution past the cap", () => {
    const code = getOrCreateReferralCode("referrer-1")
    let firstId = ""
    for (let i = 0; i < REFERRAL_ATTRIBUTIONS_STORE_MAX + 5; i += 1) {
      const result = recordAttribution({ code: code.code, source: "click" })
      if (i === 0 && result.recorded) firstId = result.attribution.id
    }
    expect(getReferralProgramStoreForTests().attributions).toBe(REFERRAL_ATTRIBUTIONS_STORE_MAX)
    expect(getAttribution(firstId)).toBeUndefined()
  })

  it("evicts the oldest code past the cap and frees its user", () => {
    // Fill the code store; each user gets one code.
    for (let i = 0; i < REFERRAL_CODES_STORE_MAX; i += 1) {
      getOrCreateReferralCode(`bulk-user-${i}`)
    }
    expect(getReferralProgramStoreForTests().codes).toBe(REFERRAL_CODES_STORE_MAX)

    // One more user evicts the oldest code record.
    getOrCreateReferralCode("bulk-user-late")
    expect(getReferralProgramStoreForTests().codes).toBe(REFERRAL_CODES_STORE_MAX)
    expect(getReferralCodeForUser("bulk-user-0")).toBeNull()
    // The evicted user can mint a fresh code on next call.
    const fresh = getOrCreateReferralCode("bulk-user-0")
    expect(fresh.code).toMatch(REFERRAL_CODE_PATTERN)
  })
})

/* ------------------------------------------------------------------ */
/* Misc                                                                */
/* ------------------------------------------------------------------ */

describe("misc", () => {
  it("status guard covers the enum", () => {
    for (const status of REFERRAL_ATTRIBUTION_STATUSES) {
      expect(isReferralAttributionStatus(status)).toBe(true)
    }
    expect(isReferralAttributionStatus("bogus")).toBe(false)
  })
})
