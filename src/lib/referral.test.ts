import { describe, expect, it, beforeEach } from "vitest"

import {
  buildReferralShareUrl,
  consumeStoredReferralCode,
  isAnyReferralCode,
  isReferralCode,
  isVanityReferralCode,
  normalizeReferralVanityCode,
  readStoredReferralCode,
  referralCodeFromSearch,
  REFERRAL_CODE_PATTERN,
  REFERRAL_STORAGE_KEY,
  storeReferralCode,
} from "./referral"

const VALID = "SPN-ABCD-EFGH"

beforeEach(() => {
  localStorage.clear()
})

describe("isReferralCode", () => {
  it("accepts generated code shapes", () => {
    expect(isReferralCode(VALID)).toBe(true)
    expect(isReferralCode("SPN-2345-6789")).toBe(true)
    expect(REFERRAL_CODE_PATTERN.test("SPN-ABCD-EFGH")).toBe(true)
  })

  it("rejects malformed values", () => {
    expect(isReferralCode("spn-abcd-efgh")).toBe(false)
    expect(isReferralCode("SPN-ABC-EFGH")).toBe(false)
    expect(isReferralCode("SPN-ABCDE-FGHI")).toBe(false)
    expect(isReferralCode("SPN-ABCD-EFG0")).toBe(false) // 0 not in alphabet
    expect(isReferralCode("")).toBe(false)
    expect(isReferralCode(null)).toBe(false)
    expect(isReferralCode(undefined)).toBe(false)
  })
})

describe("referralCodeFromSearch", () => {
  it("extracts a valid code from a query string", () => {
    expect(referralCodeFromSearch("?ref=SPN-ABCD-EFGH")).toBe(VALID)
    expect(referralCodeFromSearch("ref=SPN-ABCD-EFGH&utm=x")).toBe(VALID)
  })

  it("returns null for missing or invalid codes", () => {
    expect(referralCodeFromSearch("")).toBeNull()
    expect(referralCodeFromSearch("?ref=bogus")).toBeNull()
    expect(referralCodeFromSearch("?other=1")).toBeNull()
  })
})

describe("storeReferralCode / readStoredReferralCode", () => {
  it("persists a valid code and reads it back", () => {
    storeReferralCode(VALID)
    expect(localStorage.getItem(REFERRAL_STORAGE_KEY)).toBe(VALID)
    expect(readStoredReferralCode()).toBe(VALID)
  })

  it("ignores invalid codes", () => {
    storeReferralCode("nope")
    expect(readStoredReferralCode()).toBeNull()
  })

  it("does not store a self-referral", () => {
    storeReferralCode(VALID, VALID)
    expect(readStoredReferralCode()).toBeNull()
  })

  it("reads null for corrupted storage", () => {
    localStorage.setItem(REFERRAL_STORAGE_KEY, "garbage")
    expect(readStoredReferralCode()).toBeNull()
  })
})

describe("consumeStoredReferralCode", () => {
  it("returns the code once and clears it", () => {
    storeReferralCode(VALID)
    expect(consumeStoredReferralCode()).toBe(VALID)
    expect(consumeStoredReferralCode()).toBeNull()
  })
})

describe("vanity codes", () => {
  it("isVanityReferralCode accepts SPN-<slug> shapes", () => {
    expect(isVanityReferralCode("SPN-BOGDAN")).toBe(true)
    expect(isVanityReferralCode("SPN-LAB-GEAR-2")).toBe(true)
    expect(isVanityReferralCode("spn-bogdan")).toBe(false)
    expect(isVanityReferralCode("SPN-AB")).toBe(false) // slug too short
    expect(isVanityReferralCode("SPN--BOGDAN")).toBe(false) // leading dash
    expect(isVanityReferralCode("SPN-BOGDAN-")).toBe(false) // trailing dash
    expect(isVanityReferralCode("SPN-BO GDAN")).toBe(false) // space
  })

  it("isAnyReferralCode accepts generated and vanity codes", () => {
    expect(isAnyReferralCode(VALID)).toBe(true)
    expect(isAnyReferralCode("SPN-BOGDAN")).toBe(true)
    expect(isAnyReferralCode("nope")).toBe(false)
    expect(isAnyReferralCode(null)).toBe(false)
  })

  it("normalizeReferralVanityCode canonicalizes slugs", () => {
    expect(normalizeReferralVanityCode("bogdan")).toBe("SPN-BOGDAN")
    expect(normalizeReferralVanityCode("  spn-lab-gear  ")).toBe("SPN-LAB-GEAR")
    expect(normalizeReferralVanityCode("LabGear2")).toBe("SPN-LABGEAR2")
  })

  it("normalizeReferralVanityCode rejects invalid input", () => {
    expect(normalizeReferralVanityCode("")).toBeNull()
    expect(normalizeReferralVanityCode("ab")).toBeNull() // too short
    expect(normalizeReferralVanityCode("a".repeat(21))).toBeNull() // too long
    expect(normalizeReferralVanityCode("-bogdan")).toBeNull()
    expect(normalizeReferralVanityCode("bogdan!")).toBeNull()
    // Slug reproducing the generated SPN-XXXX-XXXX shape is rejected.
    expect(normalizeReferralVanityCode("ABCD-EFGH")).toBeNull()
    expect(normalizeReferralVanityCode("SPN-ABCD-EFGH")).toBeNull()
  })

  it("stores and reads vanity codes through the same localStorage path", () => {
    storeReferralCode("SPN-BOGDAN")
    expect(readStoredReferralCode()).toBe("SPN-BOGDAN")
    expect(consumeStoredReferralCode()).toBe("SPN-BOGDAN")
  })

  it("referralCodeFromSearch accepts vanity codes", () => {
    expect(referralCodeFromSearch("?ref=SPN-BOGDAN")).toBe("SPN-BOGDAN")
  })
})

describe("buildReferralShareUrl", () => {
  it("builds /r/<code> with UTM params", () => {
    const url = buildReferralShareUrl("https://spindle.app/", VALID)
    expect(url).toBe(
      `https://spindle.app/r/${VALID}?utm_source=referral&utm_medium=share&utm_campaign=referral&utm_content=${VALID}`,
    )
  })
})
