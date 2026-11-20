import { beforeEach, describe, expect, it } from "vitest"

import {
  DISPLAY_NAME_MAX_LENGTH,
  fallbackDisplayName,
  getProfileOverride,
  parseDisplayName,
  resetProfileOverridesForTests,
  setProfileOverride,
} from "./profile"

beforeEach(() => {
  resetProfileOverridesForTests()
})

describe("parseDisplayName", () => {
  it("trims and collapses whitespace", () => {
    expect(parseDisplayName("  Ada   Lovelace  ")).toEqual({
      ok: true,
      name: "Ada Lovelace",
    })
  })

  it("rejects empty and whitespace-only names", () => {
    expect(parseDisplayName("")).toEqual({ ok: false, error: "Display name is required." })
    expect(parseDisplayName("   ")).toEqual({ ok: false, error: "Display name is required." })
  })

  it("rejects non-string values", () => {
    expect(parseDisplayName(undefined).ok).toBe(false)
    expect(parseDisplayName(42).ok).toBe(false)
    expect(parseDisplayName(null).ok).toBe(false)
  })

  it("rejects names over the max length", () => {
    const tooLong = "a".repeat(DISPLAY_NAME_MAX_LENGTH + 1)
    const result = parseDisplayName(tooLong)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain(String(DISPLAY_NAME_MAX_LENGTH))
    }
    expect(parseDisplayName("a".repeat(DISPLAY_NAME_MAX_LENGTH)).ok).toBe(true)
  })
})

describe("fallbackDisplayName", () => {
  it("capitalizes the email local part", () => {
    expect(fallbackDisplayName("ada@lab.edu")).toBe("Ada")
    expect(fallbackDisplayName("jane.doe@example.com")).toBe("Jane.doe")
  })
})

describe("profile overrides", () => {
  it("returns null for unknown principals", () => {
    expect(getProfileOverride("user:missing")).toBeNull()
  })

  it("stores and reads back an override per principal", () => {
    const record = setProfileOverride("user:u1", "Ada Lovelace")
    expect(record.name).toBe("Ada Lovelace")
    expect(typeof record.updatedAt).toBe("string")

    expect(getProfileOverride("user:u1")?.name).toBe("Ada Lovelace")
    expect(getProfileOverride("user:u2")).toBeNull()

    setProfileOverride("user:u1", "Augusta Ada")
    expect(getProfileOverride("user:u1")?.name).toBe("Augusta Ada")
  })

  it("resetProfileOverridesForTests clears the store", () => {
    setProfileOverride("user:u1", "Ada")
    resetProfileOverridesForTests()
    expect(getProfileOverride("user:u1")).toBeNull()
  })
})
