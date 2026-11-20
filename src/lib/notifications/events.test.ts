import { describe, expect, it } from "vitest"

import { isNotificationStreamEvent } from "./events"

describe("isNotificationStreamEvent", () => {
  it("accepts a notification event", () => {
    expect(
      isNotificationStreamEvent({
        type: "notification",
        notification: { type: "info", title: "Hi", body: "There" },
      }),
    ).toBe(true)
  })

  it("accepts read and read_all events", () => {
    expect(isNotificationStreamEvent({ type: "read", id: "ntf_1" })).toBe(true)
    expect(isNotificationStreamEvent({ type: "read_all" })).toBe(true)
  })

  it("accepts unread and dismiss events", () => {
    expect(isNotificationStreamEvent({ type: "unread", id: "ntf_1" })).toBe(true)
    expect(isNotificationStreamEvent({ type: "dismiss", id: "ntf_1" })).toBe(true)
    expect(isNotificationStreamEvent({ type: "unread" })).toBe(false)
    expect(isNotificationStreamEvent({ type: "dismiss", id: "" })).toBe(false)
  })

  it("accepts category, subject, and actions on notification payloads", () => {
    expect(
      isNotificationStreamEvent({
        type: "notification",
        notification: {
          type: "success",
          title: "Run finished",
          body: "Done",
          category: "agent",
          subject: "nightly diff",
          actions: [{ id: "view", label: "View run", href: "/app/agent/run_1" }],
        },
      }),
    ).toBe(true)
  })

  it("rejects malformed category, subject, and actions", () => {
    const base = { type: "notification" as const }
    expect(
      isNotificationStreamEvent({
        ...base,
        notification: { type: "info", title: "t", body: "b", category: 42 },
      }),
    ).toBe(false)
    expect(
      isNotificationStreamEvent({
        ...base,
        notification: { type: "info", title: "t", body: "b", subject: { bad: true } },
      }),
    ).toBe(false)
    expect(
      isNotificationStreamEvent({
        ...base,
        notification: {
          type: "info",
          title: "t",
          body: "b",
          actions: [{ id: "", label: "bad" }],
        },
      }),
    ).toBe(false)
    expect(
      isNotificationStreamEvent({
        ...base,
        notification: {
          type: "info",
          title: "t",
          body: "b",
          actions: Array.from({ length: 6 }, (_, i) => ({ id: `a${i}`, label: "x" })),
        },
      }),
    ).toBe(false)
  })

  it("rejects unsafe href schemes on payloads and actions", () => {
    const base = { type: "notification" as const }
    for (const href of ["javascript:alert(1)", "data:text/html,x", "//evil.example.com"]) {
      expect(
        isNotificationStreamEvent({
          ...base,
          notification: { type: "info", title: "t", body: "b", href },
        }),
      ).toBe(false)
      expect(
        isNotificationStreamEvent({
          ...base,
          notification: {
            type: "info",
            title: "t",
            body: "b",
            actions: [{ id: "a", label: "x", href }],
          },
        }),
      ).toBe(false)
    }
    expect(
      isNotificationStreamEvent({
        ...base,
        notification: { type: "info", title: "t", body: "b", href: "/app/agent/run_1" },
      }),
    ).toBe(true)
    expect(
      isNotificationStreamEvent({
        ...base,
        notification: { type: "info", title: "t", body: "b", href: "https://example.com" },
      }),
    ).toBe(true)
  })

  it("rejects malformed payloads", () => {
    expect(isNotificationStreamEvent(null)).toBe(false)
    expect(isNotificationStreamEvent("notification")).toBe(false)
    expect(isNotificationStreamEvent({ type: "unknown" })).toBe(false)
    expect(isNotificationStreamEvent({ type: "notification" })).toBe(false)
    expect(
      isNotificationStreamEvent({
        type: "notification",
        notification: { type: "info", title: "", body: "x" },
      }),
    ).toBe(false)
    expect(
      isNotificationStreamEvent({
        type: "notification",
        notification: { type: "bogus", title: "t", body: "b" },
      }),
    ).toBe(false)
    expect(isNotificationStreamEvent({ type: "read" })).toBe(false)
    expect(isNotificationStreamEvent({ type: "read", id: 42 })).toBe(false)
  })
})
