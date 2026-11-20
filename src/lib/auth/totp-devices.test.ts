import { beforeEach, describe, expect, it } from "vitest"

import {
  DEFAULT_DEVICE_LABEL,
  MemoryTrustedDeviceStore,
  isTrustedTotpDevice,
  markTrustedDeviceUsedByFingerprint,
  normalizeDeviceLabel,
  setTrustedDeviceStoreForTests,
} from "./totp-devices"

const FP_A = "fp1:" + "a".repeat(64)
const FP_B = "fp1:" + "b".repeat(64)

function trust(store: MemoryTrustedDeviceStore, overrides = {}) {
  return store.trust({
    userId: "u1",
    fingerprintHash: FP_A,
    sessionId: "s1",
    label: "Work laptop",
    ...overrides,
  })
}

beforeEach(() => {
  setTrustedDeviceStoreForTests(undefined)
})

describe("MemoryTrustedDeviceStore", () => {
  it("trusts a device and lists it as active", () => {
    const store = new MemoryTrustedDeviceStore()
    const device = trust(store)

    expect(device.userId).toBe("u1")
    expect(device.label).toBe("Work laptop")
    expect(device.fingerprintHash).toBe(FP_A)
    expect(device.fingerprintVersion).toBe("fp1")
    expect(device.revokedAt).toBeNull()
    expect(store.listActive("u1")).toHaveLength(1)
    expect(store.listActive("u2")).toHaveLength(0)
  })

  it("is idempotent per (userId, fingerprint): re-trust updates, not duplicates", () => {
    const store = new MemoryTrustedDeviceStore()
    const first = trust(store)
    const second = trust(store, { label: "Renamed", sessionId: "s2" })

    expect(second.id).toBe(first.id)
    expect(second.label).toBe("Renamed")
    expect(second.sessionId).toBe("s2")
    expect(store.listActive("u1")).toHaveLength(1)
  })

  it("re-trusting a revoked device reactivates the same record", () => {
    const store = new MemoryTrustedDeviceStore()
    const device = trust(store)
    expect(store.revoke("u1", device.id)).toBe(true)
    expect(store.listActive("u1")).toHaveLength(0)

    const revived = trust(store)
    expect(revived.id).toBe(device.id)
    expect(revived.revokedAt).toBeNull()
    expect(store.findActiveByFingerprint("u1", FP_A)?.id).toBe(device.id)
  })

  it("scopes devices per user — same fingerprint, different users", () => {
    const store = new MemoryTrustedDeviceStore()
    trust(store)
    trust(store, { userId: "u2" })

    expect(store.listActive("u1")).toHaveLength(1)
    expect(store.listActive("u2")).toHaveLength(1)
    // Revoking for u2 must not touch u1's record.
    const other = store.listActive("u2")[0]
    expect(store.revoke("u1", other.id)).toBe(false)
    expect(store.revoke("u2", other.id)).toBe(true)
    expect(store.listActive("u1")).toHaveLength(1)
  })

  it("findActiveByFingerprint returns null for revoked or unknown fingerprints", () => {
    const store = new MemoryTrustedDeviceStore()
    const device = trust(store)
    expect(store.findActiveByFingerprint("u1", FP_A)?.id).toBe(device.id)
    expect(store.findActiveByFingerprint("u1", FP_B)).toBeNull()
    expect(store.findActiveByFingerprint("u1", "not-a-fingerprint")).toBeNull()

    store.revoke("u1", device.id)
    expect(store.findActiveByFingerprint("u1", FP_A)).toBeNull()
  })

  it("markUsed bumps lastUsedAt on active records only", async () => {
    const store = new MemoryTrustedDeviceStore()
    const device = trust(store)
    const before = device.lastUsedAt
    await new Promise((resolve) => setTimeout(resolve, 5))

    store.markUsed(device.id)
    expect(store.listActive("u1")[0].lastUsedAt >= before).toBe(true)

    store.revoke("u1", device.id)
    expect(store.listActive("u1")).toHaveLength(0)
    store.markUsed(device.id) // no-op on revoked
  })

  it("revokeAll revokes every active device and reports the count", () => {
    const store = new MemoryTrustedDeviceStore()
    trust(store)
    trust(store, { fingerprintHash: FP_B, label: "Phone" })

    expect(store.revokeAll("u1")).toBe(2)
    expect(store.listActive("u1")).toHaveLength(0)
    expect(store.revokeAll("u1")).toBe(0)
  })

  it("clearForUser drops all records for that user only", () => {
    const store = new MemoryTrustedDeviceStore()
    trust(store)
    trust(store, { userId: "u2" })

    expect(store.clearForUser("u1")).toBe(1)
    expect(store.listActive("u1")).toHaveLength(0)
    expect(store.listActive("u2")).toHaveLength(1)
  })

  it("rejects malformed fingerprints", () => {
    const store = new MemoryTrustedDeviceStore()
    expect(() => trust(store, { fingerprintHash: "garbage" })).toThrow(TypeError)
    expect(() => trust(store, { fingerprintHash: "fp1:xyz" })).toThrow(TypeError)
  })

  it("normalizes mixed-case hex digests", () => {
    const store = new MemoryTrustedDeviceStore()
    const device = trust(store, { fingerprintHash: "FP1:" + "A".repeat(64) })
    expect(device.fingerprintHash).toBe("fp1:" + "a".repeat(64))
    expect(store.findActiveByFingerprint("u1", FP_A)?.id).toBe(device.id)
  })
})

describe("normalizeDeviceLabel", () => {
  it("defaults, trims, collapses whitespace, and caps length", () => {
    expect(normalizeDeviceLabel(undefined)).toBe(DEFAULT_DEVICE_LABEL)
    expect(normalizeDeviceLabel("   ")).toBe(DEFAULT_DEVICE_LABEL)
    expect(normalizeDeviceLabel("  My   Laptop  ")).toBe("My Laptop")
    expect(normalizeDeviceLabel("x".repeat(200))).toHaveLength(60)
  })
})

describe("module helpers", () => {
  it("isTrustedTotpDevice + markTrustedDeviceUsedByFingerprint round-trip", async () => {
    const store = new MemoryTrustedDeviceStore()
    setTrustedDeviceStoreForTests(store)
    const device = store.trust({
      userId: "u1",
      fingerprintHash: FP_A,
      sessionId: "s1",
    })

    expect(isTrustedTotpDevice("u1", FP_A)?.id).toBe(device.id)
    expect(isTrustedTotpDevice("u1", FP_B)).toBeNull()
    expect(isTrustedTotpDevice("u2", FP_A)).toBeNull()

    markTrustedDeviceUsedByFingerprint("u1", FP_A)
    // lastUsedAt is refreshed to "now" — assert the record is still active
    // and the call did not throw or revoke anything.
    expect(store.listActive("u1")).toHaveLength(1)
    expect(store.listActive("u1")[0].id).toBe(device.id)
  })
})
