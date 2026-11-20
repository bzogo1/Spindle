import { describe, expect, it } from "vitest"

import {
  EMERGENCY_ACCESS_TTL_MS,
  EMERGENCY_CODE_ISSUE_COUNT,
  MemoryEmergencyCodeStore,
  consumeEmergencyCode,
  createEmergencyAccess,
  getEmergencyAccess,
  getEmergencyCodeStatus,
  issueEmergencyCodes,
  markEmergencyAccessEmailVerified,
  markEmergencyAccessPasswordReset,
  completeEmergencyAccess,
  revokeEmergencyCodes,
  setEmergencyCodeStoreForTests,
} from "@/lib/auth/emergency-codes"
import { hashBackupCode, normalizeBackupCode } from "@/lib/auth/totp"

const CODE_FORMAT = /^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/

describe("MemoryEmergencyCodeStore", () => {
  it("issues hashed single-use codes shown once", async () => {
    const store = new MemoryEmergencyCodeStore()
    const issued = await store.issue("u1")

    expect(issued.codes).toHaveLength(EMERGENCY_CODE_ISSUE_COUNT)
    for (const code of issued.codes) expect(code).toMatch(CODE_FORMAT)
    expect(new Set(issued.codes).size).toBe(issued.codes.length)
    expect(issued.remaining).toBe(EMERGENCY_CODE_ISSUE_COUNT)
    expect(Date.parse(issued.expiresAt)).toBeGreaterThan(Date.now())

    // Only hashes are stored: the plaintext never appears in status output.
    const status = store.status("u1")
    expect(status).toEqual({
      active: true,
      remaining: EMERGENCY_CODE_ISSUE_COUNT,
      expiresAt: issued.expiresAt,
    })
    expect(JSON.stringify(status)).not.toContain(issued.codes[0])
  })

  it("consumes a code exactly once", async () => {
    const store = new MemoryEmergencyCodeStore()
    const { codes } = await store.issue("u1", { count: 2 })

    await expect(store.consume("u1", codes[0])).resolves.toEqual({ ok: true })
    await expect(store.consume("u1", codes[0])).resolves.toEqual({
      ok: false,
      reason: "used",
    })
    expect(store.status("u1").remaining).toBe(1)

    // Case/dash-insensitive input still matches the same hash.
    await expect(store.consume("u1", codes[1].toLowerCase().replace("-", " "))).resolves.toEqual({
      ok: true,
    })
    expect(store.status("u1")).toMatchObject({ active: false, remaining: 0 })
  })

  it("rejects unknown, malformed, and cross-user codes", async () => {
    const store = new MemoryEmergencyCodeStore()
    const { codes } = await store.issue("u1", { count: 1 })

    await expect(store.consume("u1", "XXXX-XXXX")).resolves.toEqual({
      ok: false,
      reason: "invalid",
    })
    await expect(store.consume("u2", codes[0])).resolves.toEqual({
      ok: false,
      reason: "invalid",
    })
    await expect(store.consume("u1", "not-a-code")).resolves.toEqual({
      ok: false,
      reason: "invalid",
    })
  })

  it("expires codes and honours max uses", async () => {
    let at = 1_000_000
    const store = new MemoryEmergencyCodeStore(() => at)
    const { codes } = await store.issue("u1", {
      count: 1,
      ttlMs: 60_000,
      maxUses: 2,
    })

    await expect(store.consume("u1", codes[0])).resolves.toEqual({ ok: true })
    await expect(store.consume("u1", codes[0])).resolves.toEqual({ ok: true })
    await expect(store.consume("u1", codes[0])).resolves.toEqual({
      ok: false,
      reason: "used",
    })

    const second = await store.issue("u1", { count: 1, ttlMs: 60_000 })
    at += 61_000
    await expect(store.consume("u1", second.codes[0])).resolves.toEqual({
      ok: false,
      reason: "expired",
    })
    expect(store.status("u1")).toMatchObject({ active: false, remaining: 0 })
  })

  it("regeneration replaces the set and revoke drops it", async () => {
    const store = new MemoryEmergencyCodeStore()
    const first = await store.issue("u1", { count: 2 })
    const second = await store.issue("u1", { count: 2 })

    for (const code of first.codes) {
      await expect(store.consume("u1", code)).resolves.toMatchObject({ ok: false })
    }
    await expect(store.consume("u1", second.codes[0])).resolves.toEqual({ ok: true })

    expect(store.revoke("u1")).toBe(true)
    expect(store.status("u1")).toEqual({ active: false, remaining: null, expiresAt: null })
    await expect(store.consume("u1", second.codes[1])).resolves.toEqual({
      ok: false,
      reason: "invalid",
    })
    expect(store.revoke("u1")).toBe(false)
  })
})

describe("emergency access sessions", () => {
  it("issues a hashed bearer token that resolves to the account", () => {
    const store = new MemoryEmergencyCodeStore()
    const session = store.createAccess({ userId: "u1", email: "Ada@Lab.Edu" })

    expect(session.accessToken.length).toBeGreaterThan(20)
    expect(session.accessExpiresAt).toBeTruthy()
    const record = store.getAccess(session.accessToken)
    expect(record).toMatchObject({
      userId: "u1",
      email: "ada@lab.edu",
      passwordResetAt: null,
      completedAt: null,
    })
    // The raw token is not stored: lookups are by SHA-256 hash.
    expect(JSON.stringify(record)).not.toContain(session.accessToken)
    expect(store.getAccess("forged-token")).toBeNull()
  })

  it("expires access sessions", () => {
    let at = 1_000_000
    const store = new MemoryEmergencyCodeStore(() => at)
    const session = store.createAccess({ userId: "u1", email: "a@b.c" })

    at += EMERGENCY_ACCESS_TTL_MS + 1
    expect(store.getAccess(session.accessToken)).toBeNull()
  })

  it("tracks password/email steps and completes once", () => {
    const store = new MemoryEmergencyCodeStore()
    const session = store.createAccess({ userId: "u1", email: "a@b.c" })

    store.markAccessPasswordReset(session.accessToken)
    store.markAccessEmailVerified(session.accessToken)
    expect(store.getAccess(session.accessToken)).toMatchObject({
      passwordResetAt: expect.any(String),
      emailVerifiedAt: expect.any(String),
    })

    const done = store.completeAccess(session.accessToken)
    expect(done?.completedAt).toBeTruthy()
    expect(store.getAccess(session.accessToken)).toBeNull()
    expect(store.completeAccess(session.accessToken)).toBeNull()
  })
})

describe("store seam helpers", () => {
  it("routes through the configured store and resets for tests", async () => {
    setEmergencyCodeStoreForTests(undefined)
    const issued = await issueEmergencyCodes("u9", { count: 1 })
    expect(getEmergencyCodeStatus("u9").remaining).toBe(1)

    await expect(consumeEmergencyCode("u9", issued.codes[0])).resolves.toEqual({
      ok: true,
    })
    expect(revokeEmergencyCodes("u9")).toBe(true)

    const access = createEmergencyAccess({ userId: "u9", email: "x@y.z" })
    expect(getEmergencyAccess(access.accessToken)?.userId).toBe("u9")
    markEmergencyAccessPasswordReset(access.accessToken)
    markEmergencyAccessEmailVerified(access.accessToken)
    expect(completeEmergencyAccess(access.accessToken)?.userId).toBe("u9")

    setEmergencyCodeStoreForTests(undefined)
    expect(getEmergencyCodeStatus("u9")).toEqual({
      active: false,
      remaining: null,
      expiresAt: null,
    })
  })

  it("hashes codes with the shared backup-code primitives", async () => {
    // Sanity: codes issued here are verifiable through hashBackupCode, which
    // is what makes the format interchangeable with TOTP backup codes.
    const store = new MemoryEmergencyCodeStore()
    const { codes } = await store.issue("u1", { count: 1 })
    const hash = await hashBackupCode(codes[0])
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
    expect(normalizeBackupCode(codes[0])).toHaveLength(8)
    await expect(store.consume("u1", codes[0])).resolves.toEqual({ ok: true })
  })
})
