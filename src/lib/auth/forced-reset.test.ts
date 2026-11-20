import { beforeEach, describe, expect, it } from "vitest"

import {
  FORCED_RESET_MAX_ENTRIES,
  MemoryForcedResetStore,
  mustResetPassword,
  setForcedResetStoreForTests,
} from "./forced-reset"

beforeEach(() => {
  setForcedResetStoreForTests(undefined)
})

describe("MemoryForcedResetStore", () => {
  it("reports no requirement for unknown or cleared users", () => {
    const store = new MemoryForcedResetStore()
    expect(store.get("u1")).toBeNull()
    store.require("u1")
    store.clear("u1")
    expect(store.get("u1")).toBeNull()
    // Clearing a user that was never flagged is a no-op.
    expect(() => store.clear("ghost")).not.toThrow()
  })

  it("stores reason, setBy, and setAt when requiring", () => {
    const store = new MemoryForcedResetStore()
    const flag = store.require(
      "u1",
      { reason: "breached password", setBy: "admin@lab.edu" },
      1_700_000_000_000,
    )
    expect(flag).toEqual({
      required: true,
      reason: "breached password",
      setBy: "admin@lab.edu",
      setAt: new Date(1_700_000_000_000).toISOString(),
    })
    expect(store.get("u1")).toEqual(flag)
  })

  it("defaults reason/setBy to null and trims whitespace", () => {
    const store = new MemoryForcedResetStore()
    const flag = store.require("u1", { reason: "   ", setBy: "  " })
    expect(flag.reason).toBeNull()
    expect(flag.setBy).toBeNull()
    const bare = store.require("u2")
    expect(bare.reason).toBeNull()
    expect(bare.setBy).toBeNull()
  })

  it("re-requiring refreshes the metadata (newest wins)", () => {
    const store = new MemoryForcedResetStore()
    store.require("u1", { reason: "first", setBy: "a@x" }, 1_000)
    const second = store.require("u1", { reason: "second", setBy: "b@x" }, 2_000)
    expect(store.get("u1")).toEqual(second)
    expect(second.reason).toBe("second")
    expect(second.setBy).toBe("b@x")
    expect(second.setAt).toBe(new Date(2_000).toISOString())
  })

  it("returns a copy so callers cannot mutate stored state", () => {
    const store = new MemoryForcedResetStore()
    store.require("u1")
    const flag = store.get("u1")
    expect(flag).not.toBeNull()
    flag!.reason = "tampered"
    expect(store.get("u1")?.reason).toBeNull()
  })

  it("rejects an empty userId", () => {
    const store = new MemoryForcedResetStore()
    expect(() => store.require("   ")).toThrow()
    expect(store.get("")).toBeNull()
  })

  it("evicts the oldest entries past the cap", () => {
    const store = new MemoryForcedResetStore()
    for (let i = 0; i < FORCED_RESET_MAX_ENTRIES + 5; i += 1) {
      store.require(`u${i}`)
    }
    expect(store.get("u0")).toBeNull()
    expect(store.get("u4")).toBeNull()
    expect(store.get(`u${FORCED_RESET_MAX_ENTRIES + 4}`)).not.toBeNull()
  })
})

describe("forced-reset store seam", () => {
  it("mustResetPassword reflects the active store", () => {
    expect(mustResetPassword("u1")).toBe(false)
    const store = new MemoryForcedResetStore()
    setForcedResetStoreForTests(store)
    store.require("u1")
    expect(mustResetPassword("u1")).toBe(true)
    expect(mustResetPassword("u2")).toBe(false)
    store.clear("u1")
    expect(mustResetPassword("u1")).toBe(false)
  })
})
