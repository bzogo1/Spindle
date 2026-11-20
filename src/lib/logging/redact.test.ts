// @vitest-environment node

import { describe, expect, it } from "vitest"

import { REDACTED } from "../logger"
import { hashIdentifier, isPiiKey, maskEmail, redactPii } from "./redact"

describe("maskEmail", () => {
  it("keeps the first local character and the domain", () => {
    expect(maskEmail("jane.doe@example.com")).toBe("j***@example.com")
  })

  it("redacts malformed values", () => {
    expect(maskEmail("not-an-email")).toBe(REDACTED)
    expect(maskEmail("@example.com")).toBe(REDACTED)
  })
})

describe("hashIdentifier", () => {
  it("is stable and does not contain the raw value", () => {
    const hash = hashIdentifier("user_123")
    expect(hash).toMatch(/^[0-9a-f]{16}$/)
    expect(hashIdentifier("user_123")).toBe(hash)
    expect(hash).not.toContain("user_123")
  })

  it("changes with a different salt", () => {
    expect(hashIdentifier("user_123", "other")).not.toBe(hashIdentifier("user_123"))
  })
})

describe("isPiiKey", () => {
  it("matches normalised PII keys", () => {
    expect(isPiiKey("email")).toBe(true)
    expect(isPiiKey("Email-Address")).toBe(true)
    expect(isPiiKey("phoneNumber")).toBe(true)
    expect(isPiiKey("requestId")).toBe(false)
    expect(isPiiKey("userId")).toBe(false)
  })
})

describe("redactPii", () => {
  it("masks emails and redacts other PII fields recursively", () => {
    const input = {
      user: {
        email: "jane.doe@example.com",
        phoneNumber: "+1 555 0100",
        address: "1 Main St",
      },
      contacts: [{ email: "bob@example.org" }],
      note: "contact jane.doe@example.com for details",
    }

    const result = redactPii(input)

    expect(result.user.email).toBe("j***@example.com")
    expect(result.user.phoneNumber).toBe(REDACTED)
    expect(result.user.address).toBe(REDACTED)
    expect(result.contacts[0].email).toBe("b***@example.org")
    // Free text is left untouched; masking prose is the core logger's job
    // for credentials only, so document that PII in strings is not rewritten.
    expect(result.note).toContain("jane.doe@example.com")
    // Input is not mutated
    expect(input.user.email).toBe("jane.doe@example.com")
  })

  it("handles circular references and deep nesting", () => {
    const input: Record<string, unknown> = { email: "a@b.co" }
    input.self = input
    input.deep = { deeper: { phone: "123" } }

    const result = redactPii(input)

    expect(result.self).toBe("[Circular]")
    expect((result.deep as Record<string, unknown>).deeper).toEqual({ phone: REDACTED })
  })

  it("passes through non-object values", () => {
    expect(redactPii("plain string")).toBe("plain string")
    expect(redactPii(42)).toBe(42)
    expect(redactPii(null)).toBeNull()
  })
})
