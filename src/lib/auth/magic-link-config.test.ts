import { describe, expect, it } from "vitest"

import {
  DEFAULT_MAGIC_LINK_TTL_MINUTES,
  formatMagicLinkExpiry,
  getMagicLinkConfig,
  MAGIC_LINK_TTL_ENV_VAR,
  MAX_MAGIC_LINK_TTL_MINUTES,
  MIN_MAGIC_LINK_TTL_MINUTES,
  parseMagicLinkTtlMinutes,
  sanitizeMagicLinkNextPath,
} from "./magic-link-config"

describe("parseMagicLinkTtlMinutes", () => {
  it("falls back to the default when unset or blank", () => {
    expect(parseMagicLinkTtlMinutes(undefined)).toBe(DEFAULT_MAGIC_LINK_TTL_MINUTES)
    expect(parseMagicLinkTtlMinutes("")).toBe(DEFAULT_MAGIC_LINK_TTL_MINUTES)
    expect(parseMagicLinkTtlMinutes("   ")).toBe(DEFAULT_MAGIC_LINK_TTL_MINUTES)
  })

  it("falls back to the default for non-numeric or non-positive values", () => {
    for (const raw of ["abc", "NaN", "Infinity", "0", "-5", "15min"]) {
      expect(parseMagicLinkTtlMinutes(raw)).toBe(DEFAULT_MAGIC_LINK_TTL_MINUTES)
    }
  })

  it("accepts a valid override", () => {
    expect(parseMagicLinkTtlMinutes("30")).toBe(30)
    expect(parseMagicLinkTtlMinutes(" 45 ")).toBe(45)
    expect(parseMagicLinkTtlMinutes("2.5")).toBe(2.5)
  })

  it("clamps values outside the allowed bounds", () => {
    expect(parseMagicLinkTtlMinutes("0.2")).toBe(MIN_MAGIC_LINK_TTL_MINUTES)
    expect(parseMagicLinkTtlMinutes("9999")).toBe(MAX_MAGIC_LINK_TTL_MINUTES)
  })
})

describe("getMagicLinkConfig", () => {
  it("returns the default 15 minute TTL when the env var is missing", () => {
    const config = getMagicLinkConfig({})
    expect(config.ttlMs).toBe(15 * 60 * 1000)
    expect(config.expiresInMinutes).toBe(15)
  })

  it("reads MAGIC_LINK_TTL_MINUTES from the provided source", () => {
    const config = getMagicLinkConfig({ [MAGIC_LINK_TTL_ENV_VAR]: "30" })
    expect(config.ttlMs).toBe(30 * 60 * 1000)
    expect(config.expiresInMinutes).toBe(30)
  })

  it("clamps the TTL into the supported range", () => {
    expect(getMagicLinkConfig({ [MAGIC_LINK_TTL_ENV_VAR]: "0.1" }).ttlMs).toBe(
      MIN_MAGIC_LINK_TTL_MINUTES * 60 * 1000,
    )
    expect(getMagicLinkConfig({ [MAGIC_LINK_TTL_ENV_VAR]: "100000" }).ttlMs).toBe(
      MAX_MAGIC_LINK_TTL_MINUTES * 60 * 1000,
    )
  })
})

describe("formatMagicLinkExpiry", () => {
  it("formats whole minutes with correct pluralization", () => {
    expect(formatMagicLinkExpiry(1)).toBe("1 minute")
    expect(formatMagicLinkExpiry(15)).toBe("15 minutes")
    expect(formatMagicLinkExpiry(60)).toBe("60 minutes")
  })

  it("formats fractional minutes", () => {
    expect(formatMagicLinkExpiry(2.5)).toBe("2.5 minutes")
    expect(formatMagicLinkExpiry(2.55)).toBe("2.6 minutes")
  })
})

describe("sanitizeMagicLinkNextPath", () => {
  it("accepts safe same-origin app paths", () => {
    expect(sanitizeMagicLinkNextPath("/dashboard")).toBe("/dashboard")
    expect(sanitizeMagicLinkNextPath("/dashboard/files?folder=lab")).toBe(
      "/dashboard/files?folder=lab",
    )
    expect(sanitizeMagicLinkNextPath("/")).toBe("/")
  })

  it("rejects missing, absolute, and protocol-relative values", () => {
    for (const value of [
      undefined,
      null,
      "",
      "dashboard",
      "https://evil.example",
      "//evil.example",
      "javascript:alert(1)",
    ]) {
      expect(sanitizeMagicLinkNextPath(value)).toBeNull()
    }
  })

  it("rejects backslash paths that URL parsers normalize off-site", () => {
    expect(sanitizeMagicLinkNextPath("/\\evil.example")).toBeNull()
    expect(sanitizeMagicLinkNextPath("/dashboard\\..\\evil")).toBeNull()
  })

  it("rejects control characters", () => {
    expect(sanitizeMagicLinkNextPath("/dashboard\n//evil.example")).toBeNull()
    expect(sanitizeMagicLinkNextPath("/dashboard\t/files")).toBeNull()
    expect(sanitizeMagicLinkNextPath("/dashboard\u007ffiles")).toBeNull()
  })

  it("rejects overly long values", () => {
    expect(sanitizeMagicLinkNextPath(`/${"a".repeat(3000)}`)).toBeNull()
  })
})
