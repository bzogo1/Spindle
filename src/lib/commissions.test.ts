// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest"

import {
  COMMISSIONS_STORE_MAX,
  COMMISSION_STATUSES,
  CommissionTransitionError,
  approveCommission,
  clearCommissionsForTests,
  commissionTotalsForAffiliate,
  listCommissions,
  markCommissionPaid,
  recordCommission,
  resetCommissionsForTests,
  voidCommission,
} from "./commissions"

beforeEach(() => {
  resetCommissionsForTests()
})

describe("recordCommission", () => {
  it("creates a pending USD commission with timestamps", () => {
    const record = recordCommission({
      affiliateId: "aff_1",
      amountCents: 1250,
      reason: "Conversion payout",
    })

    expect(record.id).toMatch(/^com_/)
    expect(record.affiliateId).toBe("aff_1")
    expect(record.amountCents).toBe(1250)
    expect(record.currency).toBe("USD")
    expect(record.status).toBe("pending")
    expect(record.reason).toBe("Conversion payout")
    expect(record.createdAt).toBeTruthy()
    expect(record.updatedAt).toBe(record.createdAt)
    expect(record.conversionId).toBeUndefined()
  })

  it("stores an optional conversionId and defaults the reason", () => {
    const record = recordCommission({
      affiliateId: "aff_1",
      conversionId: "afv_123",
      amountCents: 0,
    })
    expect(record.conversionId).toBe("afv_123")
    expect(record.reason).toBe("Manual commission entry.")
  })

  it("accepts a zero-cent commission", () => {
    const record = recordCommission({ affiliateId: "aff_1", amountCents: 0 })
    expect(record.amountCents).toBe(0)
  })

  it("rejects a missing affiliate id", () => {
    expect(() => recordCommission({ affiliateId: "  ", amountCents: 100 })).toThrow(
      /affiliate id is required/,
    )
  })

  it("rejects non-integer and negative amounts", () => {
    expect(() => recordCommission({ affiliateId: "aff_1", amountCents: 10.5 })).toThrow(
      /non-negative integer/,
    )
    expect(() => recordCommission({ affiliateId: "aff_1", amountCents: -1 })).toThrow(
      /non-negative integer/,
    )
    expect(() => recordCommission({ affiliateId: "aff_1", amountCents: Number.NaN })).toThrow(
      /non-negative integer/,
    )
  })

  it("rejects an over-long reason", () => {
    expect(() =>
      recordCommission({ affiliateId: "aff_1", amountCents: 1, reason: "x".repeat(501) }),
    ).toThrow(/at most 500/)
  })

  it("enforces the store bound", () => {
    for (let i = 0; i < COMMISSIONS_STORE_MAX; i += 1) {
      recordCommission({ affiliateId: "aff_1", amountCents: 1 })
    }
    expect(() => recordCommission({ affiliateId: "aff_1", amountCents: 1 })).toThrow(/at capacity/)
    // The bound is a hard cap — earlier records are never evicted.
    expect(listCommissions()).toHaveLength(COMMISSIONS_STORE_MAX)
  }, 30_000)
})

describe("status machine", () => {
  const seed = () => recordCommission({ affiliateId: "aff_1", amountCents: 500, reason: "test" })

  it("walks pending → approved → paid", () => {
    const record = seed()
    const approved = approveCommission(record.id)
    expect(approved?.status).toBe("approved")
    expect(approved?.updatedAt).toBeTruthy()
    expect(approved!.updatedAt >= record.createdAt).toBe(true)

    const paid = markCommissionPaid(record.id)
    expect(paid?.status).toBe("paid")
    expect(paid!.updatedAt >= approved!.updatedAt).toBe(true)
  })

  it("voids from pending and from approved", () => {
    const a = seed()
    expect(voidCommission(a.id)?.status).toBe("void")

    const b = seed()
    approveCommission(b.id)
    expect(voidCommission(b.id)?.status).toBe("void")
  })

  it("rejects illegal transitions with CommissionTransitionError", () => {
    const record = seed()
    expect(() => markCommissionPaid(record.id)).toThrow(CommissionTransitionError)
    expect(() => markCommissionPaid(record.id)).toThrow(
      /Cannot mark-paid a commission in status "pending"/,
    )

    approveCommission(record.id)
    expect(() => approveCommission(record.id)).toThrow(
      /Cannot approve a commission in status "approved"/,
    )

    voidCommission(record.id)
    expect(() => approveCommission(record.id)).toThrow(/status "void"/)
    expect(() => voidCommission(record.id)).toThrow(/status "void"/)
    expect(() => markCommissionPaid(record.id)).toThrow(/status "void"/)
  })

  it("paid is terminal — cannot be voided or re-approved", () => {
    const record = seed()
    approveCommission(record.id)
    markCommissionPaid(record.id)
    expect(() => voidCommission(record.id)).toThrow(/status "paid"/)
    expect(() => approveCommission(record.id)).toThrow(/status "paid"/)
    expect(() => markCommissionPaid(record.id)).toThrow(/status "paid"/)
  })

  it("returns null for unknown ids without throwing", () => {
    expect(approveCommission("com_missing")).toBeNull()
    expect(voidCommission("com_missing")).toBeNull()
    expect(markCommissionPaid("com_missing")).toBeNull()
  })

  it("does not mutate the record on a rejected transition", () => {
    const record = seed()
    try {
      markCommissionPaid(record.id)
    } catch {
      // expected
    }
    expect(listCommissions()[0]?.status).toBe("pending")
  })
})

describe("listCommissions", () => {
  it("returns newest first and filters by affiliateId and status", () => {
    const first = recordCommission({ affiliateId: "aff_a", amountCents: 100 })
    const second = recordCommission({ affiliateId: "aff_b", amountCents: 200 })
    const third = recordCommission({ affiliateId: "aff_a", amountCents: 300 })
    approveCommission(third.id)

    expect(listCommissions().map((r) => r.id)).toEqual([third.id, second.id, first.id])
    expect(listCommissions({ affiliateId: "aff_a" })).toHaveLength(2)
    expect(listCommissions({ status: "approved" }).map((r) => r.id)).toEqual([third.id])
    expect(listCommissions({ affiliateId: "aff_a", status: "pending" }).map((r) => r.id)).toEqual([
      first.id,
    ])
    expect(listCommissions({ affiliateId: "aff_none" })).toHaveLength(0)
  })
})

describe("commissionTotalsForAffiliate", () => {
  it("totals per status in cents and counts records", () => {
    const p1 = recordCommission({ affiliateId: "aff_a", amountCents: 100 })
    const p2 = recordCommission({ affiliateId: "aff_a", amountCents: 200 })
    const approved = recordCommission({ affiliateId: "aff_a", amountCents: 300 })
    const paid = recordCommission({ affiliateId: "aff_a", amountCents: 400 })
    const voided = recordCommission({ affiliateId: "aff_a", amountCents: 50 })
    recordCommission({ affiliateId: "aff_b", amountCents: 999 })

    approveCommission(approved.id)
    approveCommission(paid.id)
    markCommissionPaid(paid.id)
    voidCommission(voided.id)
    voidCommission(p2.id) // pending → void

    expect(commissionTotalsForAffiliate("aff_a")).toEqual({
      count: 5,
      pendingCents: 100,
      approvedCents: 300,
      paidCents: 400,
      voidCents: 250,
    })
    expect(p1.status).toBe("pending")
  })

  it("returns zeros for an unknown or empty affiliate id", () => {
    const empty = {
      count: 0,
      pendingCents: 0,
      approvedCents: 0,
      paidCents: 0,
      voidCents: 0,
    }
    expect(commissionTotalsForAffiliate("aff_none")).toEqual(empty)
    expect(commissionTotalsForAffiliate("   ")).toEqual(empty)
  })
})

describe("reset hooks", () => {
  it("clearCommissionsForTests empties the ledger (alias of reset)", () => {
    recordCommission({ affiliateId: "aff_1", amountCents: 1 })
    clearCommissionsForTests()
    expect(listCommissions()).toHaveLength(0)
  })

  it("COMMISSION_STATUSES covers the documented lifecycle", () => {
    expect([...COMMISSION_STATUSES]).toEqual(["pending", "approved", "paid", "void"])
  })
})
