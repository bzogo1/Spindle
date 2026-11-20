// @vitest-environment node
import { describe, expect, it } from "vitest"

import { MemoryChallengeStore } from "./challenge-store"
import { MemoryCredentialStore, normalizeCredentialLabel } from "./credential-store"

function cred(userId: string, id: string, extra: Record<string, unknown> = {}) {
  return {
    userId,
    credentialId: id,
    publicKeyCose: "c2VjcmV0",
    counter: 0,
    transports: ["usb"],
    aaguid: null,
    ...extra,
  }
}

describe("MemoryChallengeStore", () => {
  it("issues and consumes a challenge exactly once", () => {
    const store = new MemoryChallengeStore()
    const record = store.issue({ userId: "u1", purpose: "register" })
    expect(record.challenge.length).toBeGreaterThan(20)

    const consumed = store.consume(record.id, "u1", "register")
    expect(consumed?.challenge).toBe(record.challenge)
    // Single-use: replay fails.
    expect(store.consume(record.id, "u1", "register")).toBeNull()
  })

  it("rejects wrong user, wrong purpose, unknown id, and expired challenges", () => {
    const store = new MemoryChallengeStore(1000, 100, () => 1_000)
    const record = store.issue({ userId: "u1", purpose: "authenticate" })

    expect(store.consume(record.id, "u2", "authenticate")).toBeNull()
    expect(store.consume(record.id, "u1", "register")).toBeNull()
    expect(store.consume("nope", "u1", "authenticate")).toBeNull()
    // Mismatched consumes do not burn the challenge.
    expect(store.consume(record.id, "u1", "authenticate")).not.toBeNull()

    let now = 10_000
    const timed = new MemoryChallengeStore(50, 100, () => now)
    const rec = timed.issue({ userId: "u1", purpose: "register" })
    now += 51
    expect(timed.consume(rec.id, "u1", "register")).toBeNull()
  })

  it('allows anonymous (userId "") authenticate challenges to be consumed by any user', () => {
    const store = new MemoryChallengeStore()
    const record = store.issue({ userId: "", purpose: "authenticate" })
    expect(store.consume(record.id, "owner-1", "authenticate")?.id).toBe(record.id)
    // But never for the wrong purpose.
    const record2 = store.issue({ userId: "", purpose: "authenticate" })
    expect(store.consume(record2.id, "owner-1", "register")).toBeNull()
  })

  it("round-trips the registration kind on challenges", () => {
    const store = new MemoryChallengeStore()
    const passkey = store.issue({ userId: "u1", purpose: "register", kind: "passkey" })
    expect(passkey.kind).toBe("passkey")
    const consumed = store.consume(passkey.id, "u1", "register")
    expect(consumed?.kind).toBe("passkey")

    const plain = store.issue({ userId: "u1", purpose: "register" })
    expect(plain.kind).toBeUndefined()
    expect(store.consume(plain.id, "u1", "register")?.kind).toBeUndefined()
  })

  it("keeps different purposes independent for the same user", () => {
    const store = new MemoryChallengeStore()
    const reg = store.issue({ userId: "u1", purpose: "register" })
    const auth = store.issue({ userId: "u1", purpose: "authenticate" })
    expect(store.consume(reg.id, "u1", "authenticate")).toBeNull()
    expect(store.consume(auth.id, "u1", "register")).toBeNull()
  })
})

describe("MemoryCredentialStore", () => {
  it("saves, lists, finds, renames, and revokes credentials per user", () => {
    const store = new MemoryCredentialStore()
    const saved = store.save(cred("u1", "cred-a", { label: "  YubiKey   5C  " }))
    expect(saved.label).toBe("YubiKey 5C")
    store.save(cred("u2", "cred-b"))

    expect(store.listActive("u1").map((c) => c.id)).toEqual(["cred-a"])
    expect(store.findActiveByCredentialId("cred-b")?.userId).toBe("u2")
    expect(store.findActiveForUser("u1", "cred-b")).toBeNull()

    const renamed = store.rename("u1", "cred-a", "Backup key")
    expect(renamed?.label).toBe("Backup key")
    expect(store.rename("u2", "cred-a", "nope")).toBeNull()

    expect(store.revoke("u1", "cred-a")).toBe(true)
    expect(store.findActiveByCredentialId("cred-a")).toBeNull()
    expect(store.listActive("u1")).toEqual([])
    // Foreign user cannot revoke.
    expect(store.revoke("u2", "cred-b")).toBe(true)
    expect(store.revoke("u2", "cred-b")).toBe(false)
  })

  it("rejects duplicate credential ids", () => {
    const store = new MemoryCredentialStore()
    store.save(cred("u1", "dup"))
    expect(() => store.save(cred("u2", "dup"))).toThrow(TypeError)
  })

  it("touch updates counter and lastUsedAt only for active credentials", () => {
    const store = new MemoryCredentialStore()
    store.save(cred("u1", "c1", { counter: 4 }))
    store.touch("c1", 9)
    expect(store.findActiveByCredentialId("c1")?.counter).toBe(9)
    store.revoke("u1", "c1")
    store.touch("c1", 99)
    expect(store.findActiveByCredentialId("c1")).toBeNull()
  })

  it("stores the credential kind and defaults passkey labels", () => {
    const store = new MemoryCredentialStore()
    const key = store.save(cred("u1", "k1"))
    expect(key.kind).toBe("security-key")
    expect(key.label).toBe("Security key")

    const passkey = store.save(cred("u1", "p1", { kind: "passkey" }))
    expect(passkey.kind).toBe("passkey")
    expect(passkey.label).toBe("Passkey")

    const named = store.save(cred("u1", "p2", { kind: "passkey", label: "  Work iPhone " }))
    expect(named.label).toBe("Work iPhone")

    // Renaming a passkey with an empty label falls back to "Passkey".
    expect(store.rename("u1", "p1", "   ")?.label).toBe("Passkey")
  })

  it("clearForUser removes only that user's records", () => {
    const store = new MemoryCredentialStore()
    store.save(cred("u1", "a"))
    store.save(cred("u1", "b"))
    store.save(cred("u2", "c"))
    expect(store.clearForUser("u1")).toBe(2)
    expect(store.listActive("u2")).toHaveLength(1)
  })
})

describe("normalizeCredentialLabel", () => {
  it("trims, collapses whitespace, caps length, defaults on empty", () => {
    expect(normalizeCredentialLabel("  My   Key  ")).toBe("My Key")
    expect(normalizeCredentialLabel("")).toBe("Security key")
    expect(normalizeCredentialLabel(42)).toBe("Security key")
    expect(normalizeCredentialLabel("x".repeat(100))).toHaveLength(60)
  })
})
