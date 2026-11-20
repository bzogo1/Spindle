import { describe, expect, it } from "vitest"

import {
  formatBytes,
  formatDate,
  formatDateTime,
  formatDurationMs,
  formatRelativeTime,
} from "./format"

describe("formatBytes", () => {
  it("formats bytes and larger units", () => {
    expect(formatBytes(0)).toBe("0 B")
    expect(formatBytes(-5)).toBe("0 B")
    expect(formatBytes(Number.NaN)).toBe("0 B")
    expect(formatBytes(512)).toBe("512 B")
    expect(formatBytes(1024)).toBe("1 KB")
    expect(formatBytes(1536)).toBe("1.5 KB")
    expect(formatBytes(1024 * 1024)).toBe("1 MB")
    expect(formatBytes(1024 ** 3)).toBe("1 GB")
  })

  it("caps at the largest unit", () => {
    expect(formatBytes(1024 ** 10)).toMatch(/^\d+ TB$/)
  })
})

describe("formatDate", () => {
  it("formats a valid ISO date", () => {
    // Mid-day UTC keeps the calendar day stable across most timezones.
    expect(formatDate("2025-06-10T12:00:00Z")).toMatch(/Jun 1?0, 2025|June 10, 2025/)
  })

  it("returns the raw value for invalid input", () => {
    expect(formatDate("not-a-date")).toBe("not-a-date")
    expect(formatDate("")).toBe("")
  })
})

describe("formatDateTime", () => {
  it("includes a time component", () => {
    const result = formatDateTime("2025-06-10T12:30:00Z")
    expect(result).toContain("Jun")
    expect(result).toMatch(/\d{1,2}:\d{2}/)
  })

  it("returns the raw value for invalid input", () => {
    expect(formatDateTime("garbage")).toBe("garbage")
  })
})

describe("formatDurationMs", () => {
  it("formats sub-second, second, and minute durations", () => {
    expect(formatDurationMs(250)).toBe("250ms")
    expect(formatDurationMs(8_000)).toBe("8s")
    expect(formatDurationMs(19_500)).toBe("19.5s")
    expect(formatDurationMs(95_000)).toBe("1m 35s")
    expect(formatDurationMs(120_000)).toBe("2m")
  })

  it("returns a dash for invalid input", () => {
    expect(formatDurationMs(-1)).toBe("—")
    expect(formatDurationMs(Number.NaN)).toBe("—")
  })
})

describe("formatRelativeTime", () => {
  const now = new Date("2025-06-10T12:00:00Z").getTime()
  const at = (offsetMs: number) => new Date(now - offsetMs).toISOString()

  it("formats recent times", () => {
    expect(formatRelativeTime(at(30_000), now)).toBe("just now")
    expect(formatRelativeTime(at(5 * 60_000), now)).toBe("5m ago")
    expect(formatRelativeTime(at(3 * 3_600_000), now)).toBe("3h ago")
    expect(formatRelativeTime(at(2 * 86_400_000), now)).toBe("2d ago")
  })

  it("clamps future timestamps to just now", () => {
    expect(formatRelativeTime(at(-60_000), now)).toBe("just now")
  })

  it("falls back to an absolute date past 30 days", () => {
    const result = formatRelativeTime(at(40 * 86_400_000), now)
    expect(result).toMatch(/2025|May/)
    expect(result).not.toContain("ago")
  })

  it("returns the raw value for invalid input", () => {
    expect(formatRelativeTime("nope", now)).toBe("nope")
  })
})
