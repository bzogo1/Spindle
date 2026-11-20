import { describe, expect, it, vi } from "vitest"

import {
  MAX_SNOOZE_MINUTES,
  SNOOZE_PRESETS,
  isNotificationAction,
  isSafeNotificationHref,
  sanitizeNotificationActions,
  snoozeUntilFor,
  trackNotificationAction,
} from "./actions"

vi.mock("@/lib/analytics", () => ({
  trackEvent: vi.fn(),
}))

import { trackEvent } from "@/lib/analytics"

describe("isNotificationAction", () => {
  it("accepts a minimal action", () => {
    expect(isNotificationAction({ id: "view", label: "View run" })).toBe(true)
  })

  it("accepts href, snoozeMinutes, and dismiss variants", () => {
    expect(isNotificationAction({ id: "a", label: "Open", href: "/app/agent/run_1" })).toBe(true)
    expect(isNotificationAction({ id: "b", label: "Later", snoozeMinutes: 60 })).toBe(true)
    expect(isNotificationAction({ id: "c", label: "Hide", dismiss: true })).toBe(true)
  })

  it("rejects malformed actions", () => {
    expect(isNotificationAction(null)).toBe(false)
    expect(isNotificationAction("x")).toBe(false)
    expect(isNotificationAction({ id: "", label: "No id" })).toBe(false)
    expect(isNotificationAction({ id: "a", label: "" })).toBe(false)
    expect(isNotificationAction({ id: "a", label: "L", snoozeMinutes: -5 })).toBe(false)
    expect(
      isNotificationAction({ id: "a", label: "L", snoozeMinutes: MAX_SNOOZE_MINUTES + 1 }),
    ).toBe(false)
    expect(isNotificationAction({ id: "a", label: "L", href: 42 })).toBe(false)
  })

  it("rejects actions whose href uses a dangerous scheme", () => {
    expect(isNotificationAction({ id: "a", label: "L", href: "javascript:alert(1)" })).toBe(false)
    expect(isNotificationAction({ id: "a", label: "L", href: "data:text/html,x" })).toBe(false)
    expect(isNotificationAction({ id: "a", label: "L", href: "//evil.example.com" })).toBe(false)
    expect(isNotificationAction({ id: "a", label: "L", href: "https://example.com/x" })).toBe(true)
    expect(isNotificationAction({ id: "a", label: "L", href: "mailto:a@b.c" })).toBe(true)
  })
})

describe("isSafeNotificationHref", () => {
  it("allows relative paths and anchors", () => {
    expect(isSafeNotificationHref("/app/files")).toBe(true)
    expect(isSafeNotificationHref("/dashboard/notifications")).toBe(true)
    expect(isSafeNotificationHref("#section")).toBe(true)
    expect(isSafeNotificationHref("?tab=runs")).toBe(true)
  })

  it("allows http, https, and mailto absolute URLs", () => {
    expect(isSafeNotificationHref("https://example.com/run_1")).toBe(true)
    expect(isSafeNotificationHref("http://example.com")).toBe(true)
    expect(isSafeNotificationHref("mailto:team@example.com")).toBe(true)
  })

  it("rejects scriptable, opaque, and protocol-relative URLs", () => {
    expect(isSafeNotificationHref("javascript:alert(1)")).toBe(false)
    expect(isSafeNotificationHref("JaVaScRiPt:alert(1)")).toBe(false)
    expect(isSafeNotificationHref("data:text/html,<h1>x</h1>")).toBe(false)
    expect(isSafeNotificationHref("vbscript:msgbox(1)")).toBe(false)
    expect(isSafeNotificationHref("//evil.example.com/phish")).toBe(false)
    expect(isSafeNotificationHref("file:///etc/passwd")).toBe(false)
    expect(isSafeNotificationHref("not a url at all")).toBe(false)
    expect(isSafeNotificationHref("")).toBe(false)
    expect(isSafeNotificationHref(42)).toBe(false)
    expect(isSafeNotificationHref(`https://example.com/${"x".repeat(600)}`)).toBe(false)
  })
})

describe("sanitizeNotificationActions", () => {
  it("returns undefined for non-arrays and empty results", () => {
    expect(sanitizeNotificationActions(undefined)).toBeUndefined()
    expect(sanitizeNotificationActions("nope")).toBeUndefined()
    expect(sanitizeNotificationActions([])).toBeUndefined()
    expect(sanitizeNotificationActions([{ bad: true }])).toBeUndefined()
  })

  it("keeps valid actions, drops invalid ones, caps at five", () => {
    const result = sanitizeNotificationActions([
      { id: "ok", label: "OK" },
      { id: "", label: "bad" },
      { id: "two", label: "Two", dismiss: true },
    ])
    expect(result).toEqual([
      { id: "ok", label: "OK" },
      { id: "two", label: "Two", dismiss: true },
    ])

    const many = Array.from({ length: 8 }, (_, index) => ({ id: `a${index}`, label: `A${index}` }))
    expect(sanitizeNotificationActions(many)).toHaveLength(5)
  })
})

describe("snoozeUntilFor", () => {
  const now = new Date(2025, 0, 15, 14, 30, 0) // Wed Jan 15 2025, 14:30 local

  it("adds fixed-minute offsets", () => {
    expect(snoozeUntilFor("30m", now)).toBe(new Date(2025, 0, 15, 15, 0, 0).toISOString())
    expect(snoozeUntilFor("1h", now)).toBe(new Date(2025, 0, 15, 15, 30, 0).toISOString())
  })

  it("snoozes until tomorrow at 09:00 local", () => {
    expect(snoozeUntilFor("tomorrow", now)).toBe(new Date(2025, 0, 16, 9, 0, 0).toISOString())
  })

  it("snoozes until the same time next week", () => {
    expect(snoozeUntilFor("next-week", now)).toBe(new Date(2025, 0, 22, 14, 30, 0).toISOString())
  })

  it("returns null for unknown presets", () => {
    expect(snoozeUntilFor("forever", now)).toBeNull()
  })

  it("exposes the preset list used by the UI", () => {
    expect(SNOOZE_PRESETS.map((preset) => preset.id)).toEqual([
      "30m",
      "1h",
      "tomorrow",
      "next-week",
    ])
  })
})

describe("trackNotificationAction", () => {
  it("emits a consent-gated analytics event without sensitive props", () => {
    trackNotificationAction("dismiss", { category: "agent", actionId: "archive" })
    expect(trackEvent).toHaveBeenCalledWith("notification_action", {
      kind: "dismiss",
      actionId: "archive",
      category: "agent",
    })
  })

  it("omits optional context when absent", () => {
    trackNotificationAction("mark_all_read")
    expect(trackEvent).toHaveBeenCalledWith("notification_action", { kind: "mark_all_read" })
  })
})
