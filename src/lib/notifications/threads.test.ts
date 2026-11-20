import { describe, expect, it } from "vitest"

import {
  NOTIFICATION_THREAD_WINDOW_MS,
  groupNotificationsIntoThreads,
  notificationThreadKey,
  notificationThreadSubject,
  type ThreadableNotification,
} from "./threads"

function item(overrides: Partial<ThreadableNotification> & { id: string }): ThreadableNotification {
  return {
    title: "Update",
    createdAt: "2025-01-15T12:00:00.000Z",
    read: false,
    ...overrides,
  }
}

describe("notificationThreadSubject", () => {
  it("normalizes titles: lowercase, collapsed whitespace, no trailing punctuation", () => {
    expect(notificationThreadSubject(item({ id: "a", title: "  Run   FINISHED. " }))).toBe(
      "run finished",
    )
    expect(notificationThreadSubject(item({ id: "b", title: "Run finished!" }))).toBe(
      "run finished",
    )
  })

  it("prefers an explicit subject over the title", () => {
    expect(
      notificationThreadSubject(item({ id: "a", title: "Run #42 done", subject: "Nightly diff" })),
    ).toBe("nightly diff")
  })
})

describe("notificationThreadKey", () => {
  it("combines category and subject, defaulting category to other", () => {
    expect(notificationThreadKey(item({ id: "a", title: "Ping", category: "agent" }))).toBe(
      "agent::ping",
    )
    expect(notificationThreadKey(item({ id: "b", title: "Ping" }))).toBe("other::ping")
  })
})

describe("groupNotificationsIntoThreads", () => {
  it("groups same category+subject items within the window", () => {
    const threads = groupNotificationsIntoThreads([
      item({
        id: "n1",
        title: "Run finished",
        category: "agent",
        createdAt: "2025-01-15T12:00:00Z",
      }),
      item({
        id: "n2",
        title: "Run finished.",
        category: "agent",
        createdAt: "2025-01-15T11:00:00Z",
        read: true,
      }),
      item({ id: "n3", title: "Run finished", category: "lab", createdAt: "2025-01-15T11:30:00Z" }),
      item({ id: "n4", title: "Different subject", createdAt: "2025-01-15T10:00:00Z" }),
    ])

    expect(threads).toHaveLength(3)
    const agent = threads.find((thread) => thread.category === "agent")
    expect(agent?.items.map((entry) => entry.id)).toEqual(["n1", "n2"])
    expect(agent?.unreadCount).toBe(1)
    expect(agent?.latestAt).toBe("2025-01-15T12:00:00Z")
  })

  it("splits bursts separated by more than the window", () => {
    const windowMs = 60 * 60 * 1000
    const threads = groupNotificationsIntoThreads(
      [
        item({ id: "recent", title: "Same", createdAt: "2025-01-15T12:00:00Z" }),
        item({ id: "old", title: "Same", createdAt: "2025-01-15T08:00:00Z" }),
      ],
      { windowMs },
    )
    expect(threads).toHaveLength(2)
    expect(threads[0].items.map((entry) => entry.id)).toEqual(["recent"])
    expect(threads[1].items.map((entry) => entry.id)).toEqual(["old"])
  })

  it("returns threads newest-first regardless of input order", () => {
    const threads = groupNotificationsIntoThreads([
      item({ id: "old", title: "Old topic", createdAt: "2025-01-14T10:00:00Z" }),
      item({ id: "new", title: "New topic", createdAt: "2025-01-15T10:00:00Z" }),
    ])
    expect(threads.map((thread) => thread.items[0].id)).toEqual(["new", "old"])
  })

  it("uses the default six-hour window", () => {
    expect(NOTIFICATION_THREAD_WINDOW_MS).toBe(6 * 60 * 60 * 1000)
    const threads = groupNotificationsIntoThreads([
      item({ id: "a", title: "Same", createdAt: "2025-01-15T12:00:00Z" }),
      item({ id: "b", title: "Same", createdAt: "2025-01-15T05:00:00Z" }), // 7h earlier → split
    ])
    expect(threads).toHaveLength(2)
  })

  it("handles an empty feed", () => {
    expect(groupNotificationsIntoThreads([])).toEqual([])
  })
})
