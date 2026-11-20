import { beforeEach, describe, expect, it } from "vitest"

import {
  DEFAULT_SECURITY_POLICIES,
  GLOBAL_POLICY_KEY,
  MemorySecurityPolicyStore,
  checkPolicy,
  isWithinSignInWindow,
  securityPoliciesSchema,
  setSecurityPolicyStoreForTests,
  type SecurityPolicies,
} from "./security-policies"

function policies(patch: Partial<SecurityPolicies> = {}): SecurityPolicies {
  return { ...DEFAULT_SECURITY_POLICIES, ...patch }
}

let store: MemorySecurityPolicyStore

beforeEach(() => {
  store = new MemorySecurityPolicyStore()
  setSecurityPolicyStoreForTests(store)
})

describe("MemorySecurityPolicyStore", () => {
  it("returns defaults for unknown principals", () => {
    expect(store.getPolicies("u1")).toEqual(DEFAULT_SECURITY_POLICIES)
    expect(store.getStoredPolicies("u1")).toBeNull()
  })

  it("stores and returns per-principal policies", () => {
    const saved = store.setPolicies(
      "u1",
      policies({ requireTwoFactor: true, sessionMaxAgeHours: 12 }),
    )
    expect(saved.requireTwoFactor).toBe(true)
    expect(store.getPolicies("u1")).toEqual(saved)
    expect(store.getPolicies("u2")).toEqual(DEFAULT_SECURITY_POLICIES)
  })

  it("returns copies so callers cannot mutate stored state", () => {
    store.setPolicies("u1", policies({ allowedSignInWindow: { start: "09:00", end: "17:00" } }))
    const fetched = store.getPolicies("u1")
    fetched.allowedSignInWindow!.start = "00:00"
    fetched.requireTwoFactor = true
    expect(store.getPolicies("u1").allowedSignInWindow!.start).toBe("09:00")
    expect(store.getPolicies("u1").requireTwoFactor).toBe(false)
  })

  it("falls back to the global policy when no per-user entry exists", () => {
    store.setGlobalPolicies(policies({ requireTwoFactor: true }))
    expect(store.getPolicies("u1")).toEqual(policies({ requireTwoFactor: true }))
    // A per-user entry fully replaces the global layer.
    store.setPolicies("u1", policies({ sessionMaxAgeHours: 4 }))
    expect(store.getPolicies("u1")).toEqual(policies({ sessionMaxAgeHours: 4 }))
    expect(store.getPolicies("u2").requireTwoFactor).toBe(true)
  })

  it("reset removes the override", () => {
    store.setPolicies("u1", policies({ requireTwoFactor: true }))
    store.resetPolicies("u1")
    expect(store.getStoredPolicies("u1")).toBeNull()
    expect(store.getPolicies("u1")).toEqual(DEFAULT_SECURITY_POLICIES)
  })

  it("exposes the global layer under the reserved key contract", () => {
    expect(GLOBAL_POLICY_KEY).toBe("*")
    store.setGlobalPolicies(policies({ minPasswordLength: 12 }))
    expect(store.getGlobalPolicies().minPasswordLength).toBe(12)
  })
})

describe("securityPoliciesSchema", () => {
  it("accepts a full policy object", () => {
    const parsed = securityPoliciesSchema.safeParse({
      requireTwoFactor: true,
      sessionMaxAgeHours: 24,
      allowedSignInWindow: { start: "08:30", end: "18:00" },
      minPasswordLength: 10,
    })
    expect(parsed.success).toBe(true)
  })

  it("accepts nulls for optional caps", () => {
    expect(
      securityPoliciesSchema.safeParse({
        requireTwoFactor: false,
        sessionMaxAgeHours: null,
        allowedSignInWindow: null,
        minPasswordLength: null,
      }).success,
    ).toBe(true)
  })

  it("rejects malformed windows and out-of-range values", () => {
    const base = {
      requireTwoFactor: false,
      sessionMaxAgeHours: null,
      minPasswordLength: null,
    }
    expect(
      securityPoliciesSchema.safeParse({
        ...base,
        allowedSignInWindow: { start: "25:00", end: "18:00" },
      }).success,
    ).toBe(false)
    expect(
      securityPoliciesSchema.safeParse({
        ...base,
        allowedSignInWindow: { start: "09:00", end: "09:00" },
      }).success,
    ).toBe(false)
    expect(
      securityPoliciesSchema.safeParse({
        ...base,
        allowedSignInWindow: null,
        sessionMaxAgeHours: 0,
      }).success,
    ).toBe(false)
    expect(
      securityPoliciesSchema.safeParse({ ...base, allowedSignInWindow: null, minPasswordLength: 4 })
        .success,
    ).toBe(false)
    expect(securityPoliciesSchema.safeParse({ requireTwoFactor: "yes" }).success).toBe(false)
  })

  it("rejects unknown keys (strict object)", () => {
    expect(
      securityPoliciesSchema.safeParse({
        ...DEFAULT_SECURITY_POLICIES,
        unexpected: true,
      }).success,
    ).toBe(false)
  })
})

describe("isWithinSignInWindow", () => {
  const window = { start: "09:00", end: "17:00" }

  it("matches inside the window and rejects outside", () => {
    expect(isWithinSignInWindow(window, new Date("2026-01-01T12:00:00Z"))).toBe(true)
    expect(isWithinSignInWindow(window, new Date("2026-01-01T08:59:00Z"))).toBe(false)
    expect(isWithinSignInWindow(window, new Date("2026-01-01T17:00:00Z"))).toBe(false)
  })

  it("supports overnight windows that wrap midnight", () => {
    const night = { start: "22:00", end: "06:00" }
    expect(isWithinSignInWindow(night, new Date("2026-01-01T23:30:00Z"))).toBe(true)
    expect(isWithinSignInWindow(night, new Date("2026-01-01T03:00:00Z"))).toBe(true)
    expect(isWithinSignInWindow(night, new Date("2026-01-01T12:00:00Z"))).toBe(false)
  })
})

describe("checkPolicy", () => {
  it("returns no violations for default policies", () => {
    expect(checkPolicy("u1", { method: "password", twoFactorEnabled: false }, store)).toEqual([])
  })

  it("flags missing 2FA only on non-totp channels", () => {
    store.setPolicies("u1", policies({ requireTwoFactor: true }))
    const violations = checkPolicy("u1", { method: "password", twoFactorEnabled: false }, store)
    expect(violations).toEqual([
      expect.objectContaining({ code: "two_factor_required", severity: "enforced" }),
    ])
    // totp method means the challenge already passed.
    expect(checkPolicy("u1", { method: "totp", twoFactorEnabled: false }, store)).toEqual([])
    // Enrolled accounts pass; unknown state skips the check.
    expect(checkPolicy("u1", { method: "password", twoFactorEnabled: true }, store)).toEqual([])
    expect(checkPolicy("u1", { method: "password" }, store)).toEqual([])
  })

  it("flags sign-ins outside the allowed window", () => {
    store.setPolicies("u1", policies({ allowedSignInWindow: { start: "09:00", end: "17:00" } }))
    const inside = checkPolicy(
      "u1",
      { method: "password", now: new Date("2026-01-01T10:00:00Z") },
      store,
    )
    expect(inside).toEqual([])
    const outside = checkPolicy(
      "u1",
      { method: "oauth", now: new Date("2026-01-01T23:00:00Z") },
      store,
    )
    expect(outside).toEqual([
      expect.objectContaining({ code: "outside_sign_in_window", severity: "enforced" }),
    ])
  })

  it("flags session requests above the max age as advisory", () => {
    store.setPolicies("u1", policies({ sessionMaxAgeHours: 8 }))
    const violations = checkPolicy("u1", { method: "password", requestedSessionHours: 720 }, store)
    expect(violations).toEqual([
      expect.objectContaining({ code: "session_max_age_exceeded", severity: "advisory" }),
    ])
    expect(checkPolicy("u1", { method: "password", requestedSessionHours: 8 }, store)).toEqual([])
  })

  it("flags short passwords as advisory", () => {
    store.setPolicies("u1", policies({ minPasswordLength: 12 }))
    const violations = checkPolicy("u1", { method: "password", passwordLength: 9 }, store)
    expect(violations).toEqual([
      expect.objectContaining({ code: "password_below_minimum", severity: "advisory" }),
    ])
    expect(checkPolicy("u1", { method: "password", passwordLength: 12 }, store)).toEqual([])
  })

  it("can return multiple violations at once", () => {
    store.setPolicies(
      "u1",
      policies({
        requireTwoFactor: true,
        allowedSignInWindow: { start: "09:00", end: "17:00" },
      }),
    )
    const violations = checkPolicy(
      "u1",
      {
        method: "password",
        twoFactorEnabled: false,
        now: new Date("2026-01-01T23:00:00Z"),
      },
      store,
    )
    expect(violations.map((v) => v.code)).toEqual(["two_factor_required", "outside_sign_in_window"])
  })
})
