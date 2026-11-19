import { describe, expect, it } from "vitest"

import { getTokenState, RESEND_COOLDOWN_SECONDS } from "@/lib/auth-recovery"

describe("getTokenState", () => {
  it("treats missing and explicit invalid tokens as invalid", () => {
    expect(getTokenState(undefined)).toBe("invalid")
    expect(getTokenState(null)).toBe("invalid")
    expect(getTokenState("")).toBe("invalid")
    expect(getTokenState("invalid")).toBe("invalid")
    expect(getTokenState("bad-token")).toBe("invalid")
  })

  it("detects expired and used token prefixes case-insensitively", () => {
    expect(getTokenState("expired-token")).toBe("expired")
    expect(getTokenState("EXPIRED-abc")).toBe("expired")
    expect(getTokenState("used-token")).toBe("used")
    expect(getTokenState("Used-abc")).toBe("used")
  })

  it("treats every other token as valid", () => {
    expect(getTokenState("demo-token")).toBe("valid")
    expect(getTokenState("  a8f3c2  ")).toBe("valid")
  })

  it("exports a positive resend cooldown", () => {
    expect(RESEND_COOLDOWN_SECONDS).toBeGreaterThan(0)
  })
})
