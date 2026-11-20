import { describe, expect, it } from "vitest"

import { t } from "@/lib/i18n"
import {
  isPasswordValid,
  passwordRulesMet,
  validateConfirmPassword,
  validateEmail,
  validateNewPassword,
  validateSignInPassword,
  validateTermsAccepted,
  validateWorkspaceName,
} from "./validation"

/** Validators return i18n keys; resolve them to English for assertions. */
function en(key: string | null): string | null {
  return key === null ? null : t("en", key, { min: 8, wmin: 3, wmax: 40 })
}

describe("validateEmail", () => {
  it("rejects empty and malformed addresses", () => {
    expect(en(validateEmail(""))).toBe("Enter your work email.")
    expect(en(validateEmail("   "))).toBe("Enter your work email.")
    expect(en(validateEmail("not-an-email"))).toMatch(/valid email/)
    expect(en(validateEmail("a@b"))).toMatch(/valid email/)
  })

  it("accepts a valid address and ignores surrounding whitespace", () => {
    expect(validateEmail("researcher@lab.edu")).toBeNull()
    expect(validateEmail("  researcher@lab.edu  ")).toBeNull()
  })
})

describe("password rules", () => {
  it("reports each rule independently", () => {
    expect(passwordRulesMet("short")).toEqual({
      length: false,
      letter: true,
      number: false,
    })
    expect(passwordRulesMet("abcdefg1")).toEqual({
      length: true,
      letter: true,
      number: true,
    })
    expect(isPasswordValid("abcdefg1")).toBe(true)
    expect(isPasswordValid("abcdefg")).toBe(false)
    expect(isPasswordValid("123456789")).toBe(false)
  })

  it("validates new passwords against the full rule set", () => {
    expect(en(validateNewPassword(""))).toBe("Create a password.")
    expect(en(validateNewPassword("short1a"))).toMatch(/at least 8/)
    expect(en(validateNewPassword("onlyletters"))).toMatch(/letter and a number/)
    expect(en(validateNewPassword("123456789"))).toMatch(/letter and a number/)
    expect(validateNewPassword("correct horse1")).toBeNull()
  })

  it("only requires presence for sign-in passwords", () => {
    expect(en(validateSignInPassword(""))).toBe("Enter your password.")
    expect(validateSignInPassword("x")).toBeNull()
  })
})

describe("validateConfirmPassword", () => {
  it("requires a value that matches the password", () => {
    expect(en(validateConfirmPassword("", "secret1a"))).toBe("Confirm your password.")
    expect(en(validateConfirmPassword("secret1b", "secret1a"))).toBe("Passwords don't match.")
    expect(validateConfirmPassword("secret1a", "secret1a")).toBeNull()
  })
})

describe("validateWorkspaceName", () => {
  it("enforces slug shape, length and reserved names", () => {
    expect(en(validateWorkspaceName(""))).toBe("Name your workspace.")
    expect(en(validateWorkspaceName("ab"))).toMatch(/3–40/)
    expect(en(validateWorkspaceName("Bad Name"))).toMatch(/lowercase/)
    expect(en(validateWorkspaceName("-lead"))).toMatch(/lowercase/)
    expect(en(validateWorkspaceName("trail-"))).toMatch(/lowercase/)
    expect(en(validateWorkspaceName("double--dash"))).toMatch(/lowercase/)
    expect(en(validateWorkspaceName("admin"))).toMatch(/reserved/)
    expect(en(validateWorkspaceName(`${"a".repeat(41)}`))).toMatch(/3–40/)
  })

  it("accepts valid slugs", () => {
    expect(validateWorkspaceName("coastal-resilience")).toBeNull()
    expect(validateWorkspaceName("lab-2026")).toBeNull()
  })
})

describe("validateTermsAccepted", () => {
  it("requires acceptance", () => {
    expect(en(validateTermsAccepted(false))).toMatch(/Terms of Service/)
    expect(validateTermsAccepted(true)).toBeNull()
  })
})
