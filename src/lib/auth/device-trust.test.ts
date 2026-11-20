import { beforeEach, describe, expect, it } from "vitest"

import {
  checkDeviceTrust,
  DEVICE_TRUST_TTL_MS,
  isDeviceTrusted,
  markDeviceTrustSeen,
  maskFingerprintHash,
  MAX_TRUST_TTL_MS,
  MemoryDeviceTrustStore,
  MIN_TRUST_TTL_MS,
  setDeviceTrustStoreForTests,
} from "./device-trust"

const FP = "fp1:" + "a".repeat(64)
const FP_OTHER = "fp1:" + "b".repeat(64)
const FP_V2 = "fp2:" + "c".repeat(64)

function grantInput(overrides: Partial<Parameters<MemoryDeviceTrustStore["grant"]>[0]> = {}) {
  return {
    userId: "u1",
    fingerprintHash: FP,
    sessionId: "s1",
    ...overrides,
  }
}

beforeEach(() => {
  setDeviceTrustStoreForTests(undefined)
})

describe("MemoryDeviceTrustStore.grant", () => {
  it("creates a grant with a 30-day expiry by default", () => {
    const store = new MemoryDeviceTrustStore()
    const before = Date.now()
    const grant = store.grant(grantInput({ label: "  Work   laptop " }))

    expect(grant.userId).toBe("u1")
    expect(grant.label).toBe("Work laptop")
    expect(grant.fingerprintHash).toBe(FP)
    expect(grant.fingerprintVersion).toBe("fp1")
    expect(grant.level).toBe("standard")
    expect(grant.grantedBySessionId).toBe("s1")
    expect(grant.revokedAt).toBeNull()
    expect(Date.parse(grant.expiresAt) - before).toBeGreaterThanOrEqual(DEVICE_TRUST_TTL_MS - 1000)
    expect(Date.parse(grant.expiresAt) - before).toBeLessThanOrEqual(DEVICE_TRUST_TTL_MS + 5000)
    expect(grant.grantedAt).toBe(grant.lastSeenAt)
  })

  it("rejects malformed fingerprint digests", () => {
    const store = new MemoryDeviceTrustStore()
    for (const bad of ["", "fp1", "not-a-fingerprint", "fp1:xyz", 42, null]) {
      expect(() => store.grant(grantInput({ fingerprintHash: bad as string }))).toThrow(TypeError)
    }
    expect(store.size).toBe(0)
  })

  it("normalizes case and version in the stored digest", () => {
    const store = new MemoryDeviceTrustStore()
    const grant = store.grant(grantInput({ fingerprintHash: `FP1:${"A".repeat(64)}` }))
    expect(grant.fingerprintHash).toBe(FP)
    expect(grant.fingerprintVersion).toBe("fp1")
  })

  it("clamps caller-supplied TTLs into [MIN, MAX]", () => {
    const store = new MemoryDeviceTrustStore()
    const short = store.grant(grantInput({ ttlMs: 1 }))
    expect(Date.parse(short.expiresAt) - Date.now()).toBeGreaterThanOrEqual(MIN_TRUST_TTL_MS - 1000)

    const long = store.grant(
      grantInput({ fingerprintHash: FP_OTHER, ttlMs: Number.MAX_SAFE_INTEGER }),
    )
    expect(Date.parse(long.expiresAt) - Date.now()).toBeLessThanOrEqual(MAX_TRUST_TTL_MS + 1000)
  })

  it("is idempotent per (userId, fingerprint) — re-grant refreshes the same record", () => {
    const store = new MemoryDeviceTrustStore()
    const first = store.grant(grantInput({ label: "Old label" }))
    const second = store.grant(grantInput({ label: "New label", sessionId: "s2" }))

    expect(second.id).toBe(first.id)
    expect(second.label).toBe("New label")
    expect(second.grantedAt).toBe(first.grantedAt)
    expect(second.grantedBySessionId).toBe("s2")
    expect(store.size).toBe(1)
  })

  it("reactivates a revoked grant on re-grant, preserving history", () => {
    const store = new MemoryDeviceTrustStore()
    const first = store.grant(grantInput())
    store.revoke("u1", first.id)
    const revived = store.grant(grantInput())

    expect(revived.id).toBe(first.id)
    expect(revived.revokedAt).toBeNull()
    expect(revived.grantedAt).toBe(first.grantedAt)
  })
})

describe("expiry and revocation", () => {
  it("expired grants stop matching but remain listed nowhere", () => {
    const store = new MemoryDeviceTrustStore()
    const grant = store.grant(grantInput({ ttlMs: MIN_TRUST_TTL_MS }))
    const future = Date.parse(grant.expiresAt) + 1

    expect(store.findActiveByFingerprint("u1", FP, future)).toBeNull()
    expect(store.listActive("u1", future)).toHaveLength(0)
  })

  it("revoke is scoped to the owning user", () => {
    const store = new MemoryDeviceTrustStore()
    const grant = store.grant(grantInput())

    expect(store.revoke("u2", grant.id)).toBe(false)
    expect(store.revoke("u1", grant.id)).toBe(true)
    expect(store.revoke("u1", grant.id)).toBe(false)
    expect(store.findActiveByFingerprint("u1", FP)).toBeNull()
  })

  it("revokeAll clears every active grant for the user only", () => {
    const store = new MemoryDeviceTrustStore()
    store.grant(grantInput())
    store.grant(grantInput({ fingerprintHash: FP_OTHER }))
    store.grant(grantInput({ userId: "u2" }))

    expect(store.revokeAll("u1")).toBe(2)
    expect(store.listActive("u1")).toHaveLength(0)
    expect(store.listActive("u2")).toHaveLength(1)
    expect(store.revokeAll("u1")).toBe(0)
  })

  it("markSeen bumps lastSeenAt on active grants only", () => {
    const store = new MemoryDeviceTrustStore()
    const grant = store.grant(grantInput())
    store.markSeen(grant.id, Date.parse(grant.grantedAt) + 60_000)

    const seen = store.findActiveByFingerprint("u1", FP)
    expect(seen?.lastSeenAt).toBe(new Date(Date.parse(grant.grantedAt) + 60_000).toISOString())
  })

  it("clearForUser drops all records for one user", () => {
    const store = new MemoryDeviceTrustStore()
    store.grant(grantInput())
    store.grant(grantInput({ userId: "u2" }))
    expect(store.clearForUser("u1")).toBe(1)
    expect(store.size).toBe(1)
  })
})

describe("checkDeviceTrust / isDeviceTrusted / markDeviceTrustSeen", () => {
  it("returns the grant for a trusted (user, fingerprint) pair", () => {
    const store = new MemoryDeviceTrustStore()
    const grant = store.grant(grantInput())
    setDeviceTrustStoreForTests(store)

    expect(checkDeviceTrust("u1", FP)?.id).toBe(grant.id)
    expect(isDeviceTrusted("u1", FP)).toBe(true)
    expect(isDeviceTrusted("u1", FP_OTHER)).toBe(false)
    expect(isDeviceTrusted("u2", FP)).toBe(false)
    expect(isDeviceTrusted("u1", "garbage")).toBe(false)
  })

  it("markDeviceTrustSeen updates lastSeenAt through the shared store", () => {
    const store = new MemoryDeviceTrustStore()
    store.grant(grantInput())
    setDeviceTrustStoreForTests(store)

    const later = Date.now() + 10_000
    markDeviceTrustSeen("u1", FP, later)
    expect(checkDeviceTrust("u1", FP, later)?.lastSeenAt).toBe(new Date(later).toISOString())
    // No grant → no-op, no throw.
    markDeviceTrustSeen("u1", FP_OTHER, later)
  })
})

describe("maskFingerprintHash", () => {
  it("masks the digest to version + head/tail hex", () => {
    expect(maskFingerprintHash(FP)).toBe(`fp1:${"a".repeat(6)}…aaaa`)
    expect(maskFingerprintHash(FP_V2)).toBe(`fp2:${"c".repeat(6)}…cccc`)
  })

  it("returns null for malformed input and never leaks the full digest", () => {
    expect(maskFingerprintHash("nope")).toBeNull()
    const masked = maskFingerprintHash(FP)!
    expect(masked).not.toContain(FP)
    expect(masked.length).toBeLessThan(FP.length)
  })
})
