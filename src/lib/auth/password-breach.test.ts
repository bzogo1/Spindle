// @vitest-environment node
import { describe, expect, it } from "vitest"

import { checkPasswordBreach } from "./password-breach"

describe("checkPasswordBreach — denylist", () => {
  it.each(["password", "123456", "qwerty", "iloveyou", "letmein", "admin123", "spindle123"])(
    "flags the common password %j",
    (password) => {
      const result = checkPasswordBreach(password)
      expect(result.breached).toBe(true)
      expect(result.reasons).toContain("common_password")
      expect(result.severity).toBe("high")
    },
  )

  it("flags case, symbol and leetspeak variants", () => {
    for (const password of ["PASSWORD", "P@ssw0rd", "p@ssword", "Password!", "passw0rd123"]) {
      const result = checkPasswordBreach(password)
      expect(result.breached, password).toBe(true)
      expect(result.severity).toBe("high")
    }
  })

  it("flags common base words with arbitrary trailing digits/symbols", () => {
    for (const password of ["sunshine2024", "Sunshine2024!!", "hunter999", "football#2026"]) {
      const result = checkPasswordBreach(password)
      expect(result.breached, password).toBe(true)
      expect(result.reasons).toContain("common_password")
    }
  })

  it("flags base+year expansions", () => {
    expect(checkPasswordBreach("welcome2025").breached).toBe(true)
    expect(checkPasswordBreach("dragon2020").breached).toBe(true)
  })
})

describe("checkPasswordBreach — heuristics", () => {
  it("flags keyboard walks, including partial and reversed rows", () => {
    for (const password of ["Xq9wertyuiopZ", "poiuytrewqlkj", "1qaz2wsxedc4rf"]) {
      const result = checkPasswordBreach(password)
      expect(result.breached, password).toBe(true)
      expect(result.reasons).toContain("keyboard_pattern")
    }
  })

  it("flags sequential character runs", () => {
    for (const password of ["vbnm1234qrst", "Xk9#abcd1234", "Wxyz9876&Qwer"]) {
      const result = checkPasswordBreach(password)
      expect(result.breached, password).toBe(true)
      expect(result.reasons).toContain("sequential_characters")
    }
    expect(checkPasswordBreach("vbnm1234qrst").reasons).toContain("sequential_characters")
    expect(checkPasswordBreach("Xk9#abcd1234").reasons).toContain("sequential_characters")
  })

  it("flags repeated characters and low character variety", () => {
    expect(checkPasswordBreach("passAAAAword123").reasons).toContain("repeated_characters")
    const variety = checkPasswordBreach("abcabcabcabc")
    expect(variety.reasons).toContain("low_character_variety")
  })

  it("flags long all-digit passwords", () => {
    const result = checkPasswordBreach("8374650192")
    expect(result.breached).toBe(true)
    expect(result.reasons).toContain("numeric_only")
  })
})

describe("checkPasswordBreach — clean passwords", () => {
  it.each([
    "correct horse",
    "Tr0ub4dor&3",
    "Xk9#mP2$vL8@nQ4wR7",
    "correct horse battery staple",
    "Zx9!vBn2#mQw8#pL4@sD6",
  ])("does not flag %j", (password) => {
    const result = checkPasswordBreach(password)
    expect(result.breached, JSON.stringify(result)).toBe(false)
    expect(result.reasons).toEqual([])
    expect(result.severity).toBeNull()
  })

  it("returns an empty result shape for empty input", () => {
    expect(checkPasswordBreach("")).toEqual({ breached: false, reasons: [], severity: null })
  })
})
