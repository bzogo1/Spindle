import { beforeEach, describe, expect, it } from "vitest"

import { hashPassword } from "@/lib/auth/password"
import {
  DEFAULT_PASSWORD_ROTATION_POLICY,
  MAX_PASSWORD_HISTORY,
  MemoryPasswordRotationStore,
  checkPasswordRotation,
  getPasswordRotationStatus,
  passwordRotationPolicySchema,
  recordPasswordChange,
  recordPasswordHash,
  setPasswordRotationStoreForTests,
  type PasswordRotationPolicy,
} from "./password-rotation"

function policy(patch: Partial<PasswordRotationPolicy> = {}): PasswordRotationPolicy {
  return { ...DEFAULT_PASSWORD_ROTATION_POLICY, ...patch }
}

let store: MemoryPasswordRotationStore

beforeEach(() => {
  store = new MemoryPasswordRotationStore()
  setPasswordRotationStoreForTests(store)
})

describe("MemoryPasswordRotationStore", () => {
  it("returns defaults for unknown principals", () => {
    const record = store.getRecord("u1")
    expect(record.policy).toEqual(DEFAULT_PASSWORD_ROTATION_POLICY)
    expect(record.passwordChangedAt).toBeNull()
    expect(record.historyHashes).toEqual([])
  })

  it("stores and returns per-principal policies", () => {
    store.setPolicy("u1", policy({ maxPasswordAgeDays: 90, passwordHistoryCount: 5 }))
    expect(store.getRecord("u1").policy).toEqual(
      policy({ maxPasswordAgeDays: 90, passwordHistoryCount: 5 }),
    )
    expect(store.getRecord("u2").policy).toEqual(DEFAULT_PASSWORD_ROTATION_POLICY)
  })

  it("returns copies so callers cannot mutate stored state", () => {
    store.setPolicy("u1", policy({ maxPasswordAgeDays: 30 }))
    const fetched = store.getRecord("u1")
    fetched.policy.maxPasswordAgeDays = 365
    fetched.historyHashes.push("tampered")
    expect(store.getRecord("u1").policy.maxPasswordAgeDays).toBe(30)
    expect(store.getRecord("u1").historyHashes).toEqual([])
  })

  it("recordChange stamps the date and prepends the hash, most-recent first", () => {
    const t1 = new Date("2026-01-01T00:00:00Z")
    const t2 = new Date("2026-02-01T00:00:00Z")
    store.recordChange("u1", "hash-a", t1)
    store.recordChange("u1", "hash-b", t2)
    const record = store.getRecord("u1")
    expect(record.passwordChangedAt).toBe(t2.toISOString())
    expect(record.historyHashes).toEqual(["hash-b", "hash-a"])
  })

  it("bounds history at MAX_PASSWORD_HISTORY", () => {
    for (let i = 0; i < MAX_PASSWORD_HISTORY + 5; i++) {
      store.recordChange("u1", `hash-${i}`)
    }
    expect(store.getRecord("u1").historyHashes).toHaveLength(MAX_PASSWORD_HISTORY)
    expect(store.getRecord("u1").historyHashes[0]).toBe(`hash-${MAX_PASSWORD_HISTORY + 4}`)
  })
})

describe("passwordRotationPolicySchema", () => {
  it("accepts a full policy object", () => {
    expect(
      passwordRotationPolicySchema.safeParse({
        maxPasswordAgeDays: 90,
        passwordHistoryCount: 5,
      }).success,
    ).toBe(true)
    expect(
      passwordRotationPolicySchema.safeParse({
        maxPasswordAgeDays: 0,
        passwordHistoryCount: 0,
      }).success,
    ).toBe(true)
  })

  it("rejects out-of-range and malformed values", () => {
    expect(
      passwordRotationPolicySchema.safeParse({
        maxPasswordAgeDays: -1,
        passwordHistoryCount: 0,
      }).success,
    ).toBe(false)
    expect(
      passwordRotationPolicySchema.safeParse({
        maxPasswordAgeDays: 1.5,
        passwordHistoryCount: 0,
      }).success,
    ).toBe(false)
    expect(
      passwordRotationPolicySchema.safeParse({
        maxPasswordAgeDays: 0,
        passwordHistoryCount: MAX_PASSWORD_HISTORY + 1,
      }).success,
    ).toBe(false)
    expect(passwordRotationPolicySchema.safeParse({ maxPasswordAgeDays: 30 }).success).toBe(false)
  })

  it("rejects unknown keys (strict object)", () => {
    expect(
      passwordRotationPolicySchema.safeParse({
        ...DEFAULT_PASSWORD_ROTATION_POLICY,
        unexpected: true,
      }).success,
    ).toBe(false)
  })
})

describe("getPasswordRotationStatus", () => {
  it("reports no expiry when max age is 0", () => {
    store.setPolicy("u1", policy({ maxPasswordAgeDays: 0 }))
    store.recordChange("u1", "h", new Date("2020-01-01T00:00:00Z"))
    const status = getPasswordRotationStatus("u1", new Date("2026-01-01T00:00:00Z"))
    expect(status.expired).toBe(false)
    expect(status.expiresAt).toBeNull()
    expect(status.daysRemaining).toBeNull()
    expect(status.changeRequired).toBe(false)
    expect(status.passwordAgeTracked).toBe(true)
  })

  it("computes expiry and days remaining from passwordChangedAt", () => {
    store.setPolicy("u1", policy({ maxPasswordAgeDays: 30 }))
    store.recordChange("u1", "h", new Date("2026-01-01T00:00:00Z"))
    const mid = getPasswordRotationStatus("u1", new Date("2026-01-15T00:00:00Z"))
    expect(mid.expiresAt).toBe("2026-01-31T00:00:00.000Z")
    expect(mid.daysRemaining).toBe(16)
    expect(mid.expired).toBe(false)
    expect(mid.passwordAgeTracked).toBe(true)
    const after = getPasswordRotationStatus("u1", new Date("2026-02-01T00:00:00Z"))
    expect(after.expired).toBe(true)
    expect(after.changeRequired).toBe(true)
  })

  it("treats unknown change date as expired under an active max-age policy", () => {
    store.setPolicy("u1", policy({ maxPasswordAgeDays: 90 }))
    const status = getPasswordRotationStatus("u1")
    // Advisory enforcement signal only — passwordAgeTracked=false tells
    // consumers the age is unknown and "change required" must not be
    // presented as fact while enforcement is unwired.
    expect(status.expired).toBe(true)
    expect(status.changeRequired).toBe(true)
    expect(status.passwordAgeTracked).toBe(false)
    expect(status.passwordChangedAt).toBeNull()
  })
})

describe("checkPasswordRotation", () => {
  it("returns no violations for default policy", async () => {
    expect(await checkPasswordRotation("u1", {}, store)).toEqual([])
  })

  it("flags expired passwords as enforced violations", async () => {
    store.setPolicy("u1", policy({ maxPasswordAgeDays: 30 }))
    store.recordChange("u1", "h", new Date("2020-01-01T00:00:00Z"))
    const violations = await checkPasswordRotation(
      "u1",
      { now: new Date("2026-01-01T00:00:00Z") },
      store,
    )
    expect(violations).toEqual([
      expect.objectContaining({ code: "password_expired", severity: "enforced" }),
    ])
  })

  it("does not flag fresh passwords", async () => {
    store.setPolicy("u1", policy({ maxPasswordAgeDays: 30 }))
    store.recordChange("u1", "h", new Date("2026-01-01T00:00:00Z"))
    expect(
      await checkPasswordRotation("u1", { now: new Date("2026-01-10T00:00:00Z") }, store),
    ).toEqual([])
  })

  it("rejects reuse of the last N passwords only", async () => {
    store.setPolicy("u1", policy({ passwordHistoryCount: 2 }))
    await recordPasswordChange("u1", "old-password", new Date("2026-01-01T00:00:00Z"), store)
    await recordPasswordChange("u1", "new-password", new Date("2026-01-02T00:00:00Z"), store)
    // History (most-recent first): ["new-password", "old-password"].
    const violations = await checkPasswordRotation("u1", { newPassword: "old-password" }, store)
    expect(violations).toEqual([
      expect.objectContaining({ code: "password_reused", severity: "enforced" }),
    ])
    expect(await checkPasswordRotation("u1", { newPassword: "brand-new" }, store)).toEqual([])
  })

  it("only checks the configured history window", async () => {
    store.setPolicy("u1", policy({ passwordHistoryCount: 1 }))
    await recordPasswordChange("u1", "ancient", new Date("2026-01-01T00:00:00Z"), store)
    await recordPasswordChange("u1", "recent", new Date("2026-01-02T00:00:00Z"), store)
    // "ancient" is outside the last-1 window → allowed.
    expect(await checkPasswordRotation("u1", { newPassword: "ancient" }, store)).toEqual([])
    const violations = await checkPasswordRotation("u1", { newPassword: "recent" }, store)
    expect(violations.map((v) => v.code)).toEqual(["password_reused"])
  })

  it("skips reuse checking when history count is 0 or no candidate given", async () => {
    store.setPolicy("u1", policy({ passwordHistoryCount: 0 }))
    await recordPasswordChange("u1", "same", undefined, store)
    expect(await checkPasswordRotation("u1", { newPassword: "same" }, store)).toEqual([])

    store.setPolicy("u2", policy({ passwordHistoryCount: 3 }))
    await recordPasswordChange("u2", "same", undefined, store)
    // No candidate → only expiry checks run (no max-age → clean).
    expect(await checkPasswordRotation("u2", {}, store)).toEqual([])
  })
})

describe("recordPasswordChange", () => {
  it("accepts plaintext and stores only the scrypt hash", async () => {
    const record = await recordPasswordChange("u1", "correct horse", undefined, store)
    expect(record.passwordChangedAt).not.toBeNull()
    expect(record.historyHashes).toHaveLength(1)
    expect(record.historyHashes[0]).toMatch(/^scrypt\$/)
    expect(record.historyHashes[0]).not.toContain("correct horse")
  })

  it("hashes plaintext that happens to start with 'scrypt$'", async () => {
    // Regression: the old startsWith("scrypt$") heuristic stored such a
    // password verbatim as a bogus "hash", defeating reuse checks.
    const record = await recordPasswordChange(
      "u1",
      "scrypt$looks-like-a-hash-but-is-a-password",
      undefined,
      store,
    )
    expect(record.historyHashes[0]).not.toBe("scrypt$looks-like-a-hash-but-is-a-password")
    expect(record.historyHashes[0]).toMatch(/^scrypt\$/)
  })

  it("recordPasswordHash stores a pre-computed hash unchanged (internal use)", async () => {
    const hash = await hashPassword("pre-hashed")
    const record = await recordPasswordHash("u1", hash, undefined, store)
    expect(record.historyHashes[0]).toBe(hash)
  })

  it("round-trips through checkPasswordRotation reuse detection", async () => {
    await recordPasswordChange("u1", "rotate-me-out", undefined, store)
    store.setPolicy("u1", policy({ passwordHistoryCount: 1 }))
    const violations = await checkPasswordRotation("u1", { newPassword: "rotate-me-out" }, store)
    expect(violations.map((v) => v.code)).toEqual(["password_reused"])
  })
})
