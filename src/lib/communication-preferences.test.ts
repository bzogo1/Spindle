import { beforeEach, describe, expect, it } from "vitest"

import {
  communicationPreferencesUpdateSchema,
  defaultCommunicationPreferences,
  getCommunicationPreferences,
  mergeCommunicationPreferences,
  resetCommunicationPreferencesForTests,
  updateCommunicationPreferences,
} from "./communication-preferences"

beforeEach(() => {
  resetCommunicationPreferencesForTests()
})

describe("defaultCommunicationPreferences", () => {
  it("returns the documented defaults with security alerts locked on", () => {
    expect(defaultCommunicationPreferences()).toEqual({
      productUpdates: true,
      securityAlerts: true,
      digestFrequency: "weekly",
      feedbackRequests: true,
      referralProgram: false,
    })
  })
})

describe("mergeCommunicationPreferences", () => {
  it("returns defaults for missing or non-object input", () => {
    expect(mergeCommunicationPreferences(undefined)).toEqual(defaultCommunicationPreferences())
    expect(mergeCommunicationPreferences(null)).toEqual(defaultCommunicationPreferences())
    expect(mergeCommunicationPreferences("nope")).toEqual(defaultCommunicationPreferences())
  })

  it("merges valid stored fields over the defaults", () => {
    expect(
      mergeCommunicationPreferences({ productUpdates: false, digestFrequency: "daily" }),
    ).toEqual({
      productUpdates: false,
      securityAlerts: true,
      digestFrequency: "daily",
      feedbackRequests: true,
      referralProgram: false,
    })
  })

  it("ignores invalid field values and forces security alerts on", () => {
    expect(
      mergeCommunicationPreferences({
        productUpdates: "yes",
        digestFrequency: "hourly",
        securityAlerts: false,
        referralProgram: true,
      }),
    ).toEqual({
      productUpdates: true,
      securityAlerts: true,
      digestFrequency: "weekly",
      feedbackRequests: true,
      referralProgram: true,
    })
  })
})

describe("communicationPreferencesUpdateSchema", () => {
  it("accepts an empty partial update", () => {
    expect(communicationPreferencesUpdateSchema.safeParse({}).success).toBe(true)
  })

  it("accepts each editable field", () => {
    const parsed = communicationPreferencesUpdateSchema.safeParse({
      productUpdates: false,
      digestFrequency: "off",
      feedbackRequests: false,
      referralProgram: true,
      securityAlerts: true,
    })
    expect(parsed.success).toBe(true)
  })

  it("rejects disabling security alerts", () => {
    const parsed = communicationPreferencesUpdateSchema.safeParse({ securityAlerts: false })
    expect(parsed.success).toBe(false)
  })

  it("rejects unknown keys and invalid values", () => {
    expect(
      communicationPreferencesUpdateSchema.safeParse({ digestFrequency: "hourly" }).success,
    ).toBe(false)
    expect(communicationPreferencesUpdateSchema.safeParse({ productUpdates: "yes" }).success).toBe(
      false,
    )
    expect(communicationPreferencesUpdateSchema.safeParse({ unknownField: true }).success).toBe(
      false,
    )
  })
})

describe("preference store", () => {
  it("returns defaults for a principal with no stored overrides", () => {
    expect(getCommunicationPreferences("user:1")).toEqual(defaultCommunicationPreferences())
  })

  it("partial-updates and merges with defaults on read", () => {
    updateCommunicationPreferences("user:1", { productUpdates: false })
    updateCommunicationPreferences("user:1", { digestFrequency: "daily" })

    expect(getCommunicationPreferences("user:1")).toEqual({
      productUpdates: false,
      securityAlerts: true,
      digestFrequency: "daily",
      feedbackRequests: true,
      referralProgram: false,
    })
  })

  it("scopes overrides per principal", () => {
    updateCommunicationPreferences("user:1", { referralProgram: true })
    updateCommunicationPreferences("mock:a@example.com", { referralProgram: false })

    expect(getCommunicationPreferences("user:1").referralProgram).toBe(true)
    expect(getCommunicationPreferences("mock:a@example.com").referralProgram).toBe(false)
    expect(getCommunicationPreferences("user:2").referralProgram).toBe(false)
  })
})
