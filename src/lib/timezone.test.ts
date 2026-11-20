import { describe, expect, it } from "vitest"

import {
  COMMON_TIME_ZONES,
  FALLBACK_TIME_ZONE,
  detectTimeZone,
  formatDateTimeInZone,
  formatTimeInZone,
  formatUtcOffset,
  getUtcOffsetMs,
  isValidTimeZone,
} from "./timezone"

describe("isValidTimeZone", () => {
  it("accepts real IANA zones and rejects bogus names", () => {
    expect(isValidTimeZone("Europe/Kyiv")).toBe(true)
    expect(isValidTimeZone("UTC")).toBe(true)
    expect(isValidTimeZone("Not/AZone")).toBe(false)
    expect(isValidTimeZone("")).toBe(false)
  })
})

describe("detectTimeZone", () => {
  it("honors an explicitly provided valid zone", () => {
    expect(detectTimeZone({ resolvedTimeZone: "Europe/Kyiv" })).toBe("Europe/Kyiv")
  })

  it("falls back to UTC for invalid or empty zones", () => {
    expect(detectTimeZone({ resolvedTimeZone: "Not/AZone" })).toBe(FALLBACK_TIME_ZONE)
    expect(detectTimeZone({ resolvedTimeZone: "" })).toBe(FALLBACK_TIME_ZONE)
    expect(detectTimeZone({ resolvedTimeZone: null })).toBe(FALLBACK_TIME_ZONE)
  })

  it("detects a zone from the runtime when none is provided", () => {
    const zone = detectTimeZone()
    expect(zone).toBeTruthy()
    expect(isValidTimeZone(zone)).toBe(true)
  })
})

describe("getUtcOffsetMs", () => {
  // Mid-January: Kyiv is UTC+2, New York is UTC-5, Kolkata is UTC+5:30.
  const winter = new Date("2025-01-15T12:00:00.000Z")
  // Mid-June: Kyiv is UTC+3 (DST).
  const summer = new Date("2025-06-15T12:00:00.000Z")

  it("computes offsets for zones east and west of UTC", () => {
    expect(getUtcOffsetMs("Europe/Kyiv", winter)).toBe(2 * 3_600_000)
    expect(getUtcOffsetMs("Europe/Kyiv", summer)).toBe(3 * 3_600_000)
    expect(getUtcOffsetMs("America/New_York", winter)).toBe(-5 * 3_600_000)
    expect(getUtcOffsetMs("Asia/Kolkata", winter)).toBe(5.5 * 3_600_000)
    expect(getUtcOffsetMs("UTC", winter)).toBe(0)
  })

  it("treats invalid zones as UTC", () => {
    expect(getUtcOffsetMs("Not/AZone", winter)).toBe(0)
  })
})

describe("formatUtcOffset", () => {
  const winter = new Date("2025-01-15T12:00:00.000Z")

  it("formats whole-hour, half-hour, negative, and zero offsets", () => {
    expect(formatUtcOffset("Europe/Kyiv", winter)).toBe("UTC+2")
    expect(formatUtcOffset("America/New_York", winter)).toBe("UTC-5")
    expect(formatUtcOffset("Asia/Kolkata", winter)).toBe("UTC+5:30")
    expect(formatUtcOffset("UTC", winter)).toBe("UTC")
  })
})

describe("formatTimeInZone", () => {
  it("formats wall-clock time in the requested zone", () => {
    const date = new Date("2025-06-15T12:00:00.000Z")
    // Kyiv is UTC+3 in June -> 15:00.
    expect(formatTimeInZone(date, "Europe/Kyiv", "en-GB")).toBe("15:00")
    // New York is UTC-4 in June -> 08:00.
    expect(formatTimeInZone(date, "America/New_York", "en-GB")).toBe("08:00")
  })

  it("falls back to UTC for invalid zones", () => {
    const date = new Date("2025-06-15T12:00:00.000Z")
    expect(formatTimeInZone(date, "Not/AZone", "en-GB")).toBe("12:00")
  })
})

describe("formatDateTimeInZone", () => {
  it("includes the date and time", () => {
    const date = new Date("2025-06-15T12:00:00.000Z")
    expect(formatDateTimeInZone(date, "UTC", "en-GB")).toContain("2025")
    expect(formatDateTimeInZone(date, "UTC", "en-GB")).toContain("12:00")
  })
})

describe("COMMON_TIME_ZONES", () => {
  it("lists only valid zones and includes common ones", () => {
    for (const zone of COMMON_TIME_ZONES) {
      expect(isValidTimeZone(zone)).toBe(true)
    }
    expect(COMMON_TIME_ZONES).toContain("Europe/Kyiv")
    expect(COMMON_TIME_ZONES).toContain("UTC")
  })
})
