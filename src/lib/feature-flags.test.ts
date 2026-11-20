import { beforeEach, describe, expect, it } from "vitest"

import {
  clearFeatureFlagsForTests,
  createFlag,
  deleteFlag,
  getFlagById,
  getFlagByKey,
  isFeatureEnabled,
  listEnabledFlagKeys,
  listFlags,
  updateFlag,
} from "./feature-flags"
import { hashToBucket } from "./feature-flags/evaluate"

beforeEach(() => {
  clearFeatureFlagsForTests()
})

describe("createFlag / listFlags / getFlagByKey", () => {
  it("creates a disabled flag by default with timestamps", () => {
    const flag = createFlag({ key: "new-dashboard", name: "New dashboard" })
    expect(flag.id).toMatch(/^ff_/)
    expect(flag.enabled).toBe(false)
    expect(flag.description).toBe("")
    expect(flag.createdAt).toBe(flag.updatedAt)
    expect(getFlagByKey("new-dashboard")?.id).toBe(flag.id)
    expect(listFlags()).toHaveLength(1)
  })

  it("rejects invalid keys and duplicate keys", () => {
    expect(() => createFlag({ key: "bad key!", name: "x" })).toThrow(/key/)
    expect(() => createFlag({ key: "-leading", name: "x" })).toThrow(/key/)
    createFlag({ key: "dup", name: "One" })
    expect(() => createFlag({ key: "dup", name: "Two" })).toThrow(/already exists/)
  })

  it("rejects out-of-range rolloutPercent and bad emails", () => {
    expect(() => createFlag({ key: "k", name: "n", rolloutPercent: 101 })).toThrow(/rolloutPercent/)
    expect(() => createFlag({ key: "k2", name: "n", targetEmails: ["not-an-email"] })).toThrow(
      /email/,
    )
  })

  it("normalizes emails to lowercase and dedupes targets", () => {
    const flag = createFlag({
      key: "k",
      name: "n",
      enabled: true,
      targetEmails: ["User@Example.com", "user@example.com"],
      targetUserIds: ["u1", "u1", "  "],
    })
    expect(flag.targetEmails).toEqual(["user@example.com"])
    expect(flag.targetUserIds).toEqual(["u1"])
  })
})

describe("updateFlag / deleteFlag", () => {
  it("patches fields, clears optional fields with null, bumps updatedAt", async () => {
    const flag = createFlag({
      key: "k",
      name: "n",
      enabled: true,
      rolloutPercent: 50,
      targetUserIds: ["u1"],
    })
    const updated = updateFlag(flag.id, {
      name: "Renamed",
      enabled: false,
      rolloutPercent: null,
      targetUserIds: null,
    })
    expect(updated?.name).toBe("Renamed")
    expect(updated?.enabled).toBe(false)
    expect(updated?.rolloutPercent).toBeUndefined()
    expect(updated?.targetUserIds).toBeUndefined()
    expect(updated?.createdAt).toBe(flag.createdAt)
    expect(Date.parse(updated!.updatedAt)).toBeGreaterThanOrEqual(Date.parse(flag.updatedAt))
    expect(updateFlag("missing", { name: "x" })).toBeUndefined()
    expect(deleteFlag(flag.id)).toBe(true)
    expect(deleteFlag(flag.id)).toBe(false)
    expect(getFlagById(flag.id)).toBeUndefined()
  })
})

describe("isFeatureEnabled", () => {
  it("returns false for missing or disabled flags", () => {
    expect(isFeatureEnabled("nope", { userId: "u1" })).toBe(false)
    createFlag({ key: "off", name: "n", enabled: false, rolloutPercent: 100 })
    expect(isFeatureEnabled("off", { userId: "u1" })).toBe(false)
  })

  it("explicit user/email targets enable regardless of rollout", () => {
    createFlag({
      key: "targeted",
      name: "n",
      enabled: true,
      rolloutPercent: 0,
      targetUserIds: ["u1"],
      targetEmails: ["vip@example.com"],
    })
    expect(isFeatureEnabled("targeted", { userId: "u1" })).toBe(true)
    expect(isFeatureEnabled("targeted", { email: "VIP@example.com" })).toBe(true)
    expect(isFeatureEnabled("targeted", { userId: "u2", email: "other@example.com" })).toBe(false)
  })

  it("rolloutPercent buckets stably by userId, falling back to email", () => {
    // Find a subject that lands in a low bucket so 50% is deterministic.
    const subject = { userId: "user-abc" }
    const bucket = hashToBucket("user-abc")
    createFlag({
      key: "roll",
      name: "n",
      enabled: true,
      rolloutPercent: bucket < 50 ? 60 : 40,
    })
    const expected = bucket < (bucket < 50 ? 60 : 40)
    expect(isFeatureEnabled("roll", subject)).toBe(expected)

    // Same subject → same answer on repeat evaluations.
    expect(isFeatureEnabled("roll", subject)).toBe(expected)

    // Email-only subjects hash on the email.
    createFlag({ key: "roll2", name: "n", enabled: true, rolloutPercent: 100 })
    expect(isFeatureEnabled("roll2", { email: "a@b.co" })).toBe(true)
    createFlag({ key: "roll0", name: "n", enabled: true, rolloutPercent: 0 })
    expect(isFeatureEnabled("roll0", { userId: "u", email: "a@b.co" })).toBe(false)
  })

  it("enabled flag with no targets and no rollout evaluates false", () => {
    createFlag({ key: "bare", name: "n", enabled: true })
    expect(isFeatureEnabled("bare", { userId: "u1" })).toBe(false)
  })
})

describe("listEnabledFlagKeys", () => {
  it("returns sorted keys of enabled flags only", () => {
    createFlag({ key: "b-flag", name: "b", enabled: true, rolloutPercent: 100 })
    createFlag({ key: "a-flag", name: "a", enabled: true, targetEmails: ["me@x.co"] })
    createFlag({ key: "c-flag", name: "c", enabled: false, rolloutPercent: 100 })
    expect(listEnabledFlagKeys({ userId: "u", email: "me@x.co" })).toEqual(["a-flag", "b-flag"])
    expect(listEnabledFlagKeys({ email: "other@x.co" })).toEqual(["b-flag"])
  })
})
