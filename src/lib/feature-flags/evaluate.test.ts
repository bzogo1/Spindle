import { describe, expect, it, vi } from "vitest"

import {
  evaluateFlag,
  evaluateFlagByName,
  flagEnvKey,
  hashToBucket,
  parseFlagOverride,
} from "./evaluate"
import { readFlagEnvOverrides } from "./env"
import { featureFlags, getFlagDefinition } from "./flags"
import type { FlagDefinition } from "./types"

const booleanFlag: FlagDefinition = {
  name: "test-flag",
  description: "test",
  defaults: { fallback: false, development: true },
}

const rolloutFlag: FlagDefinition = {
  name: "rollout-flag",
  description: "test",
  defaults: { fallback: false, production: { percentage: 30 } },
}

describe("flagEnvKey", () => {
  it("converts flag names to FEATURE_FLAG_* env vars", () => {
    expect(flagEnvKey("new-dashboard")).toBe("FEATURE_FLAG_NEW_DASHBOARD")
    expect(flagEnvKey("docs-search-v2")).toBe("FEATURE_FLAG_DOCS_SEARCH_V2")
    expect(flagEnvKey("  weird   name! ")).toBe("FEATURE_FLAG_WEIRD_NAME")
  })
})

describe("parseFlagOverride", () => {
  it("parses boolean spellings", () => {
    for (const raw of ["on", "true", "1", "yes", "enabled", " ON ", "True"]) {
      expect(parseFlagOverride(raw)).toBe(true)
    }
    for (const raw of ["off", "false", "0", "no", "disabled", " OFF "]) {
      expect(parseFlagOverride(raw)).toBe(false)
    }
  })

  it("parses percentages", () => {
    expect(parseFlagOverride("25")).toEqual({ percentage: 25 })
    expect(parseFlagOverride("12.5%")).toEqual({ percentage: 12.5 })
    expect(parseFlagOverride("0%")).toEqual({ percentage: 0 })
    expect(parseFlagOverride("100%")).toEqual({ percentage: 100 })
  })

  it("rejects out-of-range and malformed values", () => {
    expect(parseFlagOverride("101")).toBeUndefined()
    expect(parseFlagOverride("-5%")).toBeUndefined()
    expect(parseFlagOverride("abc")).toBeUndefined()
    expect(parseFlagOverride("")).toBeUndefined()
    expect(parseFlagOverride(undefined)).toBeUndefined()
  })
})

describe("hashToBucket", () => {
  it("is deterministic and stays within 0-99", () => {
    expect(hashToBucket("user-123")).toBe(hashToBucket("user-123"))
    for (let i = 0; i < 500; i++) {
      const bucket = hashToBucket(`subject-${i}`)
      expect(bucket).toBeGreaterThanOrEqual(0)
      expect(bucket).toBeLessThanOrEqual(99)
    }
  })

  it("distributes subjects roughly uniformly across buckets", () => {
    const counts = new Array<number>(100).fill(0)
    const total = 10_000
    for (let i = 0; i < total; i++) counts[hashToBucket(`user-${i}`)]++

    // Expected ~100 per bucket; allow a wide band to avoid flakiness while
    // still catching a broken hash (e.g. everything in a few buckets).
    for (const count of counts) {
      expect(count).toBeGreaterThan(40)
      expect(count).toBeLessThan(170)
    }
  })
})

describe("evaluateFlag", () => {
  it("uses the per-environment default", () => {
    expect(evaluateFlag(booleanFlag, { environment: "development" })).toBe(true)
    expect(evaluateFlag(booleanFlag, { environment: "production" })).toBe(false)
  })

  it("falls back to defaults.fallback for unknown environments", () => {
    expect(evaluateFlag(booleanFlag, { environment: "staging" })).toBe(false)
  })

  it("env override beats defaults in both directions", () => {
    const overrides = { FEATURE_FLAG_TEST_FLAG: "off" }
    expect(evaluateFlag(booleanFlag, { environment: "development", overrides })).toBe(false)

    const onOverrides = { FEATURE_FLAG_TEST_FLAG: "on" }
    expect(evaluateFlag(booleanFlag, { environment: "production", overrides: onOverrides })).toBe(
      true,
    )
  })

  it("numeric override acts as a percentage rollout", () => {
    const overrides = { FEATURE_FLAG_TEST_FLAG: "50%" }
    const on = Array.from({ length: 200 }, (_, i) =>
      evaluateFlag(booleanFlag, { environment: "production", subjectId: `u${i}`, overrides }),
    ).filter(Boolean)
    // ~50% of 200 subjects; allow a generous band.
    expect(on.length).toBeGreaterThan(60)
    expect(on.length).toBeLessThan(140)
  })

  it("rollout targets are deterministic per subject", () => {
    const options = { environment: "production", subjectId: "user-42" }
    expect(evaluateFlag(rolloutFlag, options)).toBe(evaluateFlag(rolloutFlag, options))
  })

  it("0% and 100% rollouts are stable regardless of subject", () => {
    const zero: FlagDefinition = {
      name: "zero",
      description: "test",
      defaults: { fallback: { percentage: 0 } },
    }
    const full: FlagDefinition = {
      name: "full",
      description: "test",
      defaults: { fallback: { percentage: 100 } },
    }
    for (const subjectId of ["", "a", "b", "user-999"]) {
      expect(evaluateFlag(zero, { subjectId })).toBe(false)
      expect(evaluateFlag(full, { subjectId })).toBe(true)
    }
  })

  it("ignores malformed overrides and uses defaults", () => {
    const overrides = { FEATURE_FLAG_TEST_FLAG: "garbage" }
    expect(evaluateFlag(booleanFlag, { environment: "development", overrides })).toBe(true)
    expect(evaluateFlag(booleanFlag, { environment: "production", overrides })).toBe(false)
  })
})

describe("evaluateFlagByName", () => {
  it("evaluates registered flags", () => {
    expect(evaluateFlagByName("new-dashboard", { environment: "development" })).toBe(true)
    expect(evaluateFlagByName("new-dashboard", { environment: "production" })).toBe(false)
  })

  it("returns false and warns for unknown flags", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    expect(evaluateFlagByName("does-not-exist")).toBe(false)
    expect(warn).toHaveBeenCalled()
  })
})

describe("registry", () => {
  it("has well-formed definitions", () => {
    for (const [key, def] of Object.entries(featureFlags)) {
      expect(def.name).toBe(key)
      expect(def.description.length).toBeGreaterThan(0)
      expect(def.defaults.fallback).toBeDefined()
    }
  })

  it("getFlagDefinition resolves known names only", () => {
    expect(getFlagDefinition("new-dashboard")?.name).toBe("new-dashboard")
    expect(getFlagDefinition("nope")).toBeUndefined()
  })
})

describe("readFlagEnvOverrides", () => {
  it("collects only FEATURE_FLAG_* keys", () => {
    const source = {
      FEATURE_FLAG_NEW_DASHBOARD: "on",
      FEATURE_FLAG_DOCS_SEARCH_V2: "25%",
      DATABASE_URL: "postgres://x",
      NEXT_PUBLIC_SITE_URL: "https://example.com",
    }
    expect(readFlagEnvOverrides(source)).toEqual({
      FEATURE_FLAG_NEW_DASHBOARD: "on",
      FEATURE_FLAG_DOCS_SEARCH_V2: "25%",
    })
  })

  it("defaults to process.env", () => {
    const overrides = readFlagEnvOverrides()
    expect(typeof overrides).toBe("object")
  })
})
