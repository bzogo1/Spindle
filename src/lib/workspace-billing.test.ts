import { describe, expect, it } from "vitest"

import {
  BILLING_PLAN_IDS,
  billingPlanCatalog,
  checkSeatLimit,
  DEFAULT_WORKSPACE_BILLING,
  getBilling,
  resetWorkspaceBillingForTests,
  updateBilling,
  WORKSPACE_BILLING_PLANS,
  workspaceBillingPatchSchema,
} from "./workspace-billing"

describe("workspace-billing", () => {
  it("returns free/active defaults for unknown workspaces", () => {
    resetWorkspaceBillingForTests()
    expect(getBilling("ws-new")).toEqual(DEFAULT_WORKSPACE_BILLING)
    expect(DEFAULT_WORKSPACE_BILLING).toMatchObject({ plan: "free", status: "active" })
  })

  it("catalog contains every plan id in order with required fields", () => {
    const catalog = billingPlanCatalog()
    expect(catalog.map((p) => p.id)).toEqual([...BILLING_PLAN_IDS])
    for (const plan of catalog) {
      expect(plan.name.length).toBeGreaterThan(0)
      expect(plan.priceLabel.length).toBeGreaterThan(0)
      expect(plan.seatLimit).toBeGreaterThan(0)
    }
    expect(WORKSPACE_BILLING_PLANS.free.seatLimit).toBeLessThan(
      WORKSPACE_BILLING_PLANS.pro.seatLimit,
    )
    expect(WORKSPACE_BILLING_PLANS.pro.seatLimit).toBeLessThan(
      WORKSPACE_BILLING_PLANS.business.seatLimit,
    )
  })

  it("updateBilling merges a partial patch and returns the full record", () => {
    resetWorkspaceBillingForTests()
    const updated = updateBilling("ws-1", {
      plan: "pro",
      status: "trialing",
      currentPeriodEnd: "2026-03-01T00:00:00.000Z",
      seatCount: 7,
    })
    expect(updated).toEqual({
      plan: "pro",
      status: "trialing",
      currentPeriodEnd: "2026-03-01T00:00:00.000Z",
      seatCount: 7,
    })
    expect(getBilling("ws-1")).toEqual(updated)

    const next = updateBilling("ws-1", { status: "active" })
    expect(next.plan).toBe("pro")
    expect(next.status).toBe("active")
    expect(next.currentPeriodEnd).toBe("2026-03-01T00:00:00.000Z")
  })

  it("updateBilling rejects invalid plan, status, and dates", () => {
    resetWorkspaceBillingForTests()
    expect(() => updateBilling("ws-1", { plan: "enterprise" as never })).toThrow()
    expect(() => updateBilling("ws-1", { status: "paused" as never })).toThrow()
    expect(() => updateBilling("ws-1", { currentPeriodEnd: "not-a-date" })).toThrow()
    expect(() => updateBilling("ws-1", { seatCount: -1 })).toThrow()
    // Failed writes must not poison the store.
    expect(getBilling("ws-1")).toEqual(DEFAULT_WORKSPACE_BILLING)
  })

  it("workspaceBillingPatchSchema is strict and validates the API patch", () => {
    expect(
      workspaceBillingPatchSchema.safeParse({
        plan: "business",
        currentPeriodEnd: null,
      }).success,
    ).toBe(true)
    expect(workspaceBillingPatchSchema.safeParse({ seatCount: 3 }).success).toBe(false)
    expect(workspaceBillingPatchSchema.safeParse({ plan: "gold" }).success).toBe(false)
    expect(workspaceBillingPatchSchema.safeParse({ currentPeriodEnd: "2026-13-99" }).success).toBe(
      false,
    )
  })

  it("currentPeriodEnd requires ISO-8601 shape, not just Date.parse-ability", () => {
    // Date.parse accepts these but they are not ISO 8601.
    for (const value of ["March 1, 2026", "1/1/2026", "2026/03/01", "tomorrow"]) {
      expect(
        workspaceBillingPatchSchema.safeParse({ currentPeriodEnd: value }).success,
        value,
      ).toBe(false)
    }
    // ISO dates and datetimes are accepted.
    for (const value of [
      "2026-03-01",
      "2026-03-01T00:00:00.000Z",
      "2026-03-01 12:30",
      "2026-03-01T12:30:00+02:00",
    ]) {
      expect(
        workspaceBillingPatchSchema.safeParse({ currentPeriodEnd: value }).success,
        value,
      ).toBe(true)
    }
    expect(() => updateBilling("ws-1", { currentPeriodEnd: "March 1, 2026" })).toThrow()
  })

  it("patch schema accepts confirmSeatOverflow but rejects other extras", () => {
    expect(
      workspaceBillingPatchSchema.safeParse({
        plan: "free",
        confirmSeatOverflow: true,
      }).success,
    ).toBe(true)
    expect(workspaceBillingPatchSchema.safeParse({ confirmSeatOverflow: "yes" }).success).toBe(
      false,
    )
    expect(workspaceBillingPatchSchema.safeParse({ confirmSeatOverflow: true }).success).toBe(true)
    // The flag alone is a valid parse but carries no stored fields.
    expect(workspaceBillingPatchSchema.parse({ confirmSeatOverflow: true })).toEqual({
      confirmSeatOverflow: true,
    })
  })

  it("checkSeatLimit reports allowed/limit/current against the stored plan", () => {
    resetWorkspaceBillingForTests()
    expect(checkSeatLimit("ws-1", 5)).toEqual({ allowed: true, limit: 5, current: 5 })
    expect(checkSeatLimit("ws-1", 6)).toEqual({ allowed: false, limit: 5, current: 6 })

    updateBilling("ws-1", { plan: "business" })
    expect(checkSeatLimit("ws-1", 150)).toEqual({
      allowed: true,
      limit: 200,
      current: 150,
    })
  })
})
