import { beforeEach, describe, expect, it } from "vitest"

import {
  USERNAME_MAX_LENGTH,
  USERNAME_MIN_LENGTH,
  clearUsernameForPrincipal,
  getHandleForPrincipal,
  getPrincipalForHandle,
  isUsernameAvailable,
  isValidUsernameFormat,
  normalizeUsername,
  parseUsername,
  resetUsernameStoreForTests,
  setUsernameForPrincipal,
} from "./username"

beforeEach(() => {
  resetUsernameStoreForTests()
})

describe("normalizeUsername", () => {
  it("trims and lowercases", () => {
    expect(normalizeUsername("  Ada_Lovelace  ")).toBe("ada_lovelace")
  })
})

describe("parseUsername", () => {
  it("accepts valid handles and normalizes case", () => {
    expect(parseUsername("Ada_99")).toEqual({ ok: true, username: "ada_99" })
    expect(parseUsername("  bob  ")).toEqual({ ok: true, username: "bob" })
  })

  it("accepts boundary lengths", () => {
    expect(parseUsername("a".repeat(USERNAME_MIN_LENGTH)).ok).toBe(true)
    expect(parseUsername("a".repeat(USERNAME_MAX_LENGTH)).ok).toBe(true)
    expect(parseUsername("a".repeat(USERNAME_MIN_LENGTH - 1)).ok).toBe(false)
    expect(parseUsername("a".repeat(USERNAME_MAX_LENGTH + 1)).ok).toBe(false)
  })

  it("rejects invalid characters", () => {
    for (const bad of ["ad-a", "ad a", "ad.a", "äd", "abc!"]) {
      expect(parseUsername(bad).ok).toBe(false)
    }
  })

  it("rejects reserved names case-insensitively", () => {
    for (const reserved of ["admin", "Support", "SPINDLE", "root"]) {
      expect(parseUsername(reserved).ok).toBe(false)
    }
  })

  it("rejects empty and non-string values", () => {
    expect(parseUsername("").ok).toBe(false)
    expect(parseUsername("   ").ok).toBe(false)
    expect(parseUsername(undefined).ok).toBe(false)
    expect(parseUsername(42).ok).toBe(false)
    expect(parseUsername(null).ok).toBe(false)
  })
})

describe("isValidUsernameFormat", () => {
  it("checks length and pattern only (not reserved/availability)", () => {
    expect(isValidUsernameFormat("admin")).toBe(true)
    expect(isValidUsernameFormat("ab")).toBe(false)
    expect(isValidUsernameFormat("has-dash")).toBe(false)
  })
})

describe("handle registry", () => {
  it("claims a handle for a principal", () => {
    const result = setUsernameForPrincipal("user:u1", "Ada_99")
    expect(result).toEqual({ ok: true, username: "ada_99" })
    expect(getHandleForPrincipal("user:u1")).toBe("ada_99")
    expect(getPrincipalForHandle("ada_99")).toBe("user:u1")
    // Lookup is case-insensitive.
    expect(getPrincipalForHandle("ADA_99")).toBe("user:u1")
  })

  it("enforces uniqueness store-wide, case-insensitively", () => {
    expect(setUsernameForPrincipal("user:u1", "ada").ok).toBe(true)
    const clash = setUsernameForPrincipal("user:u2", "ADA")
    expect(clash.ok).toBe(false)
    if (!clash.ok) expect(clash.error).toContain("taken")
    expect(getHandleForPrincipal("user:u2")).toBeNull()
  })

  it("lets a principal change handles and frees the old one", () => {
    setUsernameForPrincipal("user:u1", "ada")
    expect(setUsernameForPrincipal("user:u1", "grace")).toEqual({
      ok: true,
      username: "grace",
    })
    expect(getHandleForPrincipal("user:u1")).toBe("grace")
    expect(getPrincipalForHandle("ada")).toBeNull()
    // The freed handle can be claimed by someone else.
    expect(setUsernameForPrincipal("user:u2", "ada").ok).toBe(true)
  })

  it("treats re-claiming the same handle as a no-op success", () => {
    setUsernameForPrincipal("user:u1", "ada")
    expect(setUsernameForPrincipal("user:u1", "ADA")).toEqual({
      ok: true,
      username: "ada",
    })
  })

  it("rejects invalid and reserved handles on set", () => {
    expect(setUsernameForPrincipal("user:u1", "ab").ok).toBe(false)
    expect(setUsernameForPrincipal("user:u1", "admin").ok).toBe(false)
    expect(setUsernameForPrincipal("user:u1", 42).ok).toBe(false)
  })

  it("reports availability including the excludePrincipal escape hatch", () => {
    setUsernameForPrincipal("user:u1", "ada")
    expect(isUsernameAvailable("ada")).toBe(false)
    expect(isUsernameAvailable("ada", "user:u1")).toBe(true)
    expect(isUsernameAvailable("free_handle")).toBe(true)
    expect(isUsernameAvailable("admin")).toBe(false)
    expect(isUsernameAvailable("ab")).toBe(false)
  })

  it("clears a principal's handle", () => {
    setUsernameForPrincipal("user:u1", "ada")
    clearUsernameForPrincipal("user:u1")
    expect(getHandleForPrincipal("user:u1")).toBeNull()
    expect(getPrincipalForHandle("ada")).toBeNull()
    expect(isUsernameAvailable("ada")).toBe(true)
  })

  it("resetUsernameStoreForTests clears everything", () => {
    setUsernameForPrincipal("user:u1", "ada")
    resetUsernameStoreForTests()
    expect(getHandleForPrincipal("user:u1")).toBeNull()
    expect(isUsernameAvailable("ada")).toBe(true)
  })
})
