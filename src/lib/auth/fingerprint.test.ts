// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest"

import {
  MemoryDeviceFingerprintStore,
  parseDeviceFingerprint,
  setDeviceFingerprintStoreForTests,
} from "./fingerprint"

const HASH_A = "fp1:" + "a".repeat(64)
const HASH_B = "fp1:" + "b".repeat(64)
const HASH_C = "fp2:" + "c".repeat(64)

describe("parseDeviceFingerprint", () => {
  it("accepts versioned hex digests", () => {
    expect(parseDeviceFingerprint(HASH_A)).toEqual({
      version: "fp1",
      hash: "a".repeat(64),
    })
    expect(parseDeviceFingerprint(HASH_C)).toEqual({
      version: "fp2",
      hash: "c".repeat(64),
    })
    // Short digests (FNV fallback = 16 hex chars) are accepted too.
    expect(parseDeviceFingerprint("fp1:0123456789abcdef")).toEqual({
      version: "fp1",
      hash: "0123456789abcdef",
    })
  })

  it("rejects malformed input", () => {
    for (const bad of [
      undefined,
      null,
      42,
      {},
      "",
      "no-colon-here",
      "fp1:",
      "fp1:tooshort",
      "fp1:" + "g".repeat(64), // non-hex
      "fp1:" + "a".repeat(200), // too long
      "FP1:" + "A".repeat(64) + " extra",
    ]) {
      expect(parseDeviceFingerprint(bad)).toBeNull()
    }
  })

  it("normalizes hex case", () => {
    const parsed = parseDeviceFingerprint("FP1:" + "AB".repeat(32))
    expect(parsed?.hash).toBe("ab".repeat(32))
  })
})

describe("MemoryDeviceFingerprintStore", () => {
  let store: MemoryDeviceFingerprintStore

  beforeEach(() => {
    store = new MemoryDeviceFingerprintStore()
    setDeviceFingerprintStoreForTests(store)
  })

  it("reports 'new' for a user's first fingerprint", () => {
    const { match, record } = store.register({
      userId: "u1",
      sessionId: "s1",
      hash: HASH_A,
    })
    expect(match).toBe("new")
    expect(record.userId).toBe("u1")
    expect(record.sessionId).toBe("s1")
    expect(record.hash).toBe(HASH_A)
    expect(record.version).toBe("fp1")
    expect(record.seenCount).toBe(1)
    expect(record.hashes).toEqual([HASH_A])
  })

  it("reports 'known' when the same hash repeats on the same session", () => {
    store.register({ userId: "u1", sessionId: "s1", hash: HASH_A })
    const { match, record } = store.register({
      userId: "u1",
      sessionId: "s1",
      hash: HASH_A,
    })
    expect(match).toBe("known")
    expect(record.seenCount).toBe(2)
    expect(record.hashes).toEqual([HASH_A])
  })

  it("reports 'known' when the hash was seen on a different session of the same user", () => {
    store.register({ userId: "u1", sessionId: "s1", hash: HASH_A })
    const { match } = store.register({ userId: "u1", sessionId: "s2", hash: HASH_A })
    expect(match).toBe("known")
    expect(store.listForUser("u1")).toHaveLength(2)
  })

  it("reports 'changed' when a user presents an unseen hash", () => {
    store.register({ userId: "u1", sessionId: "s1", hash: HASH_A })
    const { match } = store.register({ userId: "u1", sessionId: "s2", hash: HASH_B })
    expect(match).toBe("changed")
  })

  it("scopes 'new'/'known'/'changed' per user", () => {
    store.register({ userId: "u1", sessionId: "s1", hash: HASH_A })
    // u2 has never been seen: same hash is still 'new' for them.
    expect(store.register({ userId: "u2", sessionId: "s9", hash: HASH_A }).match).toBe("new")
  })

  it("remembers a session's previous hash so mid-session drift reads 'changed'", () => {
    store.register({ userId: "u1", sessionId: "s1", hash: HASH_A })
    const { match, record } = store.register({
      userId: "u1",
      sessionId: "s1",
      hash: HASH_B,
    })
    expect(match).toBe("changed")
    expect(record.hash).toBe(HASH_B)
    expect(record.hashes).toEqual([HASH_A, HASH_B])
    // Returning to the earlier hash is 'known', not 'changed'.
    expect(store.register({ userId: "u1", sessionId: "s1", hash: HASH_A }).match).toBe("known")
  })

  it("supports multiple fingerprint versions side by side", () => {
    store.register({ userId: "u1", sessionId: "s1", hash: HASH_A })
    const { match, record } = store.register({
      userId: "u1",
      sessionId: "s1",
      hash: HASH_C,
    })
    expect(match).toBe("changed")
    expect(record.version).toBe("fp2")
  })

  it("getForSession / listForUser / removeSession behave", () => {
    store.register({ userId: "u1", sessionId: "s1", hash: HASH_A })
    store.register({ userId: "u1", sessionId: "s2", hash: HASH_B })
    store.register({ userId: "u2", sessionId: "s3", hash: HASH_A })

    expect(store.getForSession("s1")?.hash).toBe(HASH_A)
    expect(store.getForSession("missing")).toBeNull()
    expect(store.listForUser("u1")).toHaveLength(2)
    expect(store.listForUser("u2")).toHaveLength(1)

    expect(store.removeSession("s1")).toBe(true)
    expect(store.removeSession("s1")).toBe(false)
    expect(store.listForUser("u1")).toHaveLength(1)
    // Removing one session does not erase the user's other known hashes.
    expect(store.register({ userId: "u1", sessionId: "s4", hash: HASH_B }).match).toBe("known")
  })

  it("evicts oldest records beyond capacity", () => {
    const small = new MemoryDeviceFingerprintStore(3)
    for (let i = 0; i < 5; i += 1) {
      small.register({
        userId: "u1",
        sessionId: `s${i}`,
        hash: `fp1:${i.toString(16).padStart(64, "0")}`,
      })
    }
    expect(small.size).toBe(3)
    expect(small.getForSession("s0")).toBeNull()
    expect(small.getForSession("s4")).not.toBeNull()
  })

  it("rejects malformed hashes instead of trusting callers", () => {
    for (const bad of ["", "no-colon", "fp1:tooshort", "fp1:" + "g".repeat(64), 42 as never]) {
      expect(() => store.register({ userId: "u1", sessionId: "s1", hash: bad as string })).toThrow(
        TypeError,
      )
    }
    expect(store.size).toBe(0)
  })

  it("normalizes case and version prefix before storing", () => {
    const mixed = "FP1:" + "AB".repeat(32)
    const { record } = store.register({ userId: "u1", sessionId: "s1", hash: mixed })
    expect(record.hash).toBe("fp1:" + "ab".repeat(32))
    expect(record.version).toBe("fp1")
    // Matching is against the normalized form.
    expect(
      store.register({ userId: "u1", sessionId: "s2", hash: "fp1:" + "ab".repeat(32) }).match,
    ).toBe("known")
  })

  it("clear() empties the store", () => {
    store.register({ userId: "u1", sessionId: "s1", hash: HASH_A })
    store.clear()
    expect(store.size).toBe(0)
    expect(store.getForSession("s1")).toBeNull()
    expect(store.register({ userId: "u1", sessionId: "s1", hash: HASH_A }).match).toBe("new")
  })
})
