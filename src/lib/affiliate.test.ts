// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest"

import {
  AFFILIATE_CODE_PATTERN,
  AFFILIATES_STORE_MAX,
  AffiliateTransitionError,
  applyForAffiliate,
  approveAffiliate,
  clearAffiliateStoreForTests,
  getAffiliateByCode,
  getAffiliateByUserId,
  listAffiliates,
  recordClick,
  recordConversion,
  rejectAffiliate,
  statsForAffiliate,
  suspendAffiliate,
} from "./affiliate"

beforeEach(() => {
  clearAffiliateStoreForTests()
})

describe("applyForAffiliate", () => {
  it("creates a pending account with a unique AFF code and default rate", () => {
    const account = applyForAffiliate("user-1", "Alice@Example.com")

    expect(account.status).toBe("pending")
    expect(account.userId).toBe("user-1")
    expect(account.email).toBe("alice@example.com")
    expect(account.code).toMatch(AFFILIATE_CODE_PATTERN)
    expect(account.commissionRatePct).toBe(20)
    expect(account.createdAt).toBeTruthy()
  })

  it("generates distinct codes across applications", () => {
    const a = applyForAffiliate("user-1", "a@example.com")
    const b = applyForAffiliate("user-2", "b@example.com")
    expect(a.code).not.toBe(b.code)
  })

  it("rejects a second application from the same user", () => {
    applyForAffiliate("user-1", "a@example.com")
    expect(() => applyForAffiliate("user-1", "other@example.com")).toThrow(/already applied/)
  })

  it("rejects a second account for the same email", () => {
    applyForAffiliate("user-1", "same@example.com")
    expect(() => applyForAffiliate("user-2", "SAME@example.com")).toThrow(/already registered/)
  })

  it("rejects malformed email addresses", () => {
    for (const bad of [
      "not-an-email",
      "missing@tld",
      "two@@example.com",
      "has space@example.com",
    ]) {
      expect(() => applyForAffiliate(`user-${bad}`, bad)).toThrow(/valid email/)
    }
    // Formula-leading local parts are still plausible addresses and pass.
    expect(applyForAffiliate("user-eq", "=tag@example.com").email).toBe("=tag@example.com")
  })

  it("rejects an invalid commission rate", () => {
    expect(() => applyForAffiliate("user-1", "a@example.com", { commissionRatePct: 150 })).toThrow(
      /between 0 and 100/,
    )
  })

  it("enforces the store capacity bound", () => {
    for (let i = 0; i < AFFILIATES_STORE_MAX; i += 1) {
      applyForAffiliate(`user-${i}`, `u${i}@example.com`)
    }
    expect(() => applyForAffiliate("overflow", "o@example.com")).toThrow(/capacity/)
  })
})

describe("lookups and admin transitions", () => {
  it("finds accounts by user id and code", () => {
    const account = applyForAffiliate("user-1", "a@example.com")
    expect(getAffiliateByUserId("user-1")?.id).toBe(account.id)
    expect(getAffiliateByCode(account.code)?.id).toBe(account.id)
    expect(getAffiliateByUserId("nobody")).toBeNull()
    expect(getAffiliateByCode("AFF-NOPE-NOPE")).toBeNull()
  })

  it("lists accounts newest first, optionally filtered by status", () => {
    const first = applyForAffiliate("user-1", "a@example.com")
    const second = applyForAffiliate("user-2", "b@example.com")
    approveAffiliate(first.id)

    expect(listAffiliates().map((a) => a.id)).toEqual([second.id, first.id])
    expect(listAffiliates("active").map((a) => a.id)).toEqual([first.id])
    expect(listAffiliates("pending")).toHaveLength(1)
  })

  it("approves, suspends, and rejects accounts", () => {
    const account = applyForAffiliate("user-1", "a@example.com")

    expect(approveAffiliate(account.id)?.status).toBe("active")
    expect(suspendAffiliate(account.id)?.status).toBe("suspended")
    expect(rejectAffiliate(account.id)?.status).toBe("rejected")
    expect(approveAffiliate("missing")).toBeNull()
  })

  it("enforces the status machine and leaves status unchanged on invalid transitions", () => {
    const account = applyForAffiliate("user-1", "a@example.com")

    // pending: approve and reject are legal.
    expect(() => suspendAffiliate(account.id)).toThrow(AffiliateTransitionError)
    expect(account.status).toBe("pending")

    approveAffiliate(account.id)
    expect(account.status).toBe("active")

    // active: only suspend is legal — no approve/reject no-ops.
    expect(() => approveAffiliate(account.id)).toThrow(/Cannot approve/)
    expect(() => rejectAffiliate(account.id)).toThrow(/Cannot reject/)
    expect(account.status).toBe("active")

    suspendAffiliate(account.id)
    expect(account.status).toBe("suspended")

    // suspended: approve reactivates, reject still allowed.
    approveAffiliate(account.id)
    expect(account.status).toBe("active")

    suspendAffiliate(account.id)
    rejectAffiliate(account.id)
    expect(account.status).toBe("rejected")

    // rejected is terminal: every action is invalid.
    expect(() => approveAffiliate(account.id)).toThrow(AffiliateTransitionError)
    expect(() => rejectAffiliate(account.id)).toThrow(AffiliateTransitionError)
    expect(() => suspendAffiliate(account.id)).toThrow(AffiliateTransitionError)
    expect(account.status).toBe("rejected")
  })
})

describe("tracking", () => {
  it("records clicks only for active affiliates", () => {
    const pending = applyForAffiliate("user-1", "a@example.com")
    expect(recordClick(pending.code)).toBeNull()

    approveAffiliate(pending.id)
    const click = recordClick(pending.code, { userAgent: "test-agent", ip: "1.2.3.4" })
    expect(click?.code).toBe(pending.code)
    expect(click?.userAgent).toBe("test-agent")
    expect(click?.ip).toBe("1.2.3.4")

    suspendAffiliate(pending.id)
    expect(recordClick(pending.code)).toBeNull()
    expect(recordClick("AFF-XXXX-XXXX")).toBeNull()
  })

  it("records conversions with computed commission for active affiliates", () => {
    const account = applyForAffiliate("user-1", "a@example.com", {
      commissionRatePct: 25,
    })
    expect(recordConversion(account.code, { amountCents: 1000 })).toBeNull()

    approveAffiliate(account.id)
    const conversion = recordConversion(account.code, { amountCents: 1000 })
    expect(conversion?.amountCents).toBe(1000)
    expect(conversion?.commissionCents).toBe(250)

    const noAmount = recordConversion(account.code)
    expect(noAmount?.amountCents).toBeUndefined()
    expect(noAmount?.commissionCents).toBeUndefined()

    expect(() => recordConversion(account.code, { amountCents: -5 })).toThrow(
      /non-negative integer/,
    )
  })

  it("aggregates stats per affiliate", () => {
    const a = applyForAffiliate("user-1", "a@example.com")
    const b = applyForAffiliate("user-2", "b@example.com")
    approveAffiliate(a.id)
    approveAffiliate(b.id)

    recordClick(a.code)
    recordClick(a.code)
    recordClick(b.code)
    recordConversion(a.code, { amountCents: 2000 })
    recordConversion(a.code)
    recordConversion(b.code, { amountCents: 500 })

    expect(statsForAffiliate(a)).toEqual({
      clicks: 2,
      conversions: 2,
      revenueCents: 2000,
      commissionCents: 400,
    })
    expect(statsForAffiliate(b.id)).toEqual({
      clicks: 1,
      conversions: 1,
      revenueCents: 500,
      commissionCents: 100,
    })
    expect(statsForAffiliate("aff_missing")).toEqual({
      clicks: 0,
      conversions: 0,
      revenueCents: 0,
      commissionCents: 0,
    })
  })
})
