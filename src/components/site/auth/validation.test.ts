import { describe, expect, it } from "vitest"

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

describe("validateEmail", () => {
  it("rejects empty and malformed addresses", () => {
    expect(validateEmail("")).toBe("Enter your work email.")
    expect(validateEmail("   ")).toBe("Enter your work email.")
    expect(validateEmail("not-an-email")).toMatch(/valid email/)
    expect(validateEmail("a@b")).toMatch(/valid email/)
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
    expect(isPasswordValid("12345678")).toBe(false)
  })

  it("validates new passwords against the full rule set", () => {
    expect(validateNewPassword("")).toBe("Create a password.")
    expect(validateNewPassword("short1a")).toMatch(/at least 8/)
    expect(validateNewPassword("onlyletters")).toMatch(/letter and a number/)
    expect(validateNewPassword("123456789")).toMatch(/letter and a number/)
    expect(validateNewPassword("correct horse1")).toBeNull()
  })

  it("only requires presence for sign-in passwords", () => {
    expect(validateSignInPassword("")).toBe("Enter your password.")
    expect(validateSignInPassword("x")).toBeNull()
  })
})

describe("validateConfirmPassword", () => {
  it("requires a value that matches the password", () => {
    expect(validateConfirmPassword("", "secret1a")).toBe("Confirm your password.")
    expect(validateConfirmPassword("secret1b", "secret1a")).toBe("Passwords don't match.")
    expect(validateConfirmPassword("secret1a", "secret1a")).toBeNull()
  })
})

describe("validateWorkspaceName", () => {
  it("enforces slug shape, length and reserved names", () => {
    expect(validateWorkspaceName("")).toBe("Name your workspace.")
    expect(validateWorkspaceName("ab")).toMatch(/3–40/)
    expect(validateWorkspaceName("Bad Name")).toMatch(/lowercase/)
    expect(validateWorkspaceName("-lead")).toMatch(/lowercase/)
    expect(validateWorkspaceName("trail-")).toMatch(/lowercase/)
    expect(validateWorkspaceName("double--dash")).toMatch(/lowercase/)
    expect(validateWorkspaceName("admin")).toMatch(/reserved/)
    expect(validateWorkspaceName(`${"a".repeat(41)}`)).toMatch(/3–40/)
  })

  it("accepts valid slugs", () => {
    expect(validateWorkspaceName("coastal-resilience")).toBeNull()
    expect(validateWorkspaceName("lab-2026")).toBeNull()
  })
})

describe("validateTermsAccepted", () => {
  it("requires acceptance", () => {
    expect(validateTermsAccepted(false)).toMatch(/Terms of Service/)
    expect(validateTermsAccepted(true)).toBeNull()
  })
})
