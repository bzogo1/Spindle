import { describe, expect, it, vi } from "vitest"

import {
  ANNOUNCEMENTS_STORE_MAX,
  clearAnnouncementsForTests,
  createAnnouncement,
  dismissAnnouncement,
  listActiveAnnouncements,
  listAllAnnouncements,
} from "./announcements"

const DAY_MS = 24 * 60 * 60 * 1000
const NOW = new Date()
const PAST = new Date(NOW.getTime() - DAY_MS).toISOString()
const FUTURE = new Date(NOW.getTime() + 30 * DAY_MS).toISOString()
const EXPIRED_START = new Date(NOW.getTime() - 10 * DAY_MS).toISOString()
const EXPIRED_END = new Date(NOW.getTime() - 5 * DAY_MS).toISOString()

function input(overrides: Partial<Parameters<typeof createAnnouncement>[0]> = {}) {
  return {
    title: "New dashboard",
    body: "We shipped a new dashboard.",
    startsAt: PAST,
    ...overrides,
  }
}

describe("createAnnouncement", () => {
  it("publishes an announcement with ids and timestamps", () => {
    const announcement = createAnnouncement(input())
    expect(announcement.id).toMatch(/^ann_/)
    expect(announcement.audience).toBe("all")
    expect(announcement.publishedAt).toBe(announcement.createdAt)
    expect(announcement.endsAt).toBeUndefined()
  })

  it("trims fields and keeps optional CTA + audience + endsAt", () => {
    const announcement = createAnnouncement(
      input({
        title: "  Hello  ",
        body: "  Body  ",
        ctaLabel: " Learn more ",
        ctaHref: " /docs ",
        audience: "admins",
        endsAt: FUTURE,
      }),
    )
    expect(announcement.title).toBe("Hello")
    expect(announcement.body).toBe("Body")
    expect(announcement.ctaLabel).toBe("Learn more")
    expect(announcement.ctaHref).toBe("/docs")
    expect(announcement.audience).toBe("admins")
    expect(announcement.endsAt).toBe(new Date(FUTURE).toISOString())
  })

  it("rejects endsAt that is not after startsAt", () => {
    expect(() => createAnnouncement(input({ endsAt: PAST }))).toThrow(
      "endsAt must be after startsAt",
    )
    expect(() => createAnnouncement(input({ startsAt: FUTURE, endsAt: PAST }))).toThrow()
  })

  it("rejects unparseable dates", () => {
    expect(() => createAnnouncement(input({ startsAt: "not-a-date" }))).toThrow()
    expect(() => createAnnouncement(input({ endsAt: "garbage" }))).toThrow()
  })
})

describe("listActiveAnnouncements", () => {
  it("returns published in-window announcements for the audience", () => {
    clearAnnouncementsForTests()
    const live = createAnnouncement(input({ title: "live" }))
    createAnnouncement(input({ title: "future", startsAt: FUTURE }))
    createAnnouncement(input({ title: "expired", startsAt: EXPIRED_START, endsAt: EXPIRED_END }))
    createAnnouncement(input({ title: "admin-only", audience: "admins" }))

    const forUser = listActiveAnnouncements("u1", false, new Date())
    expect(forUser.map((a) => a.title)).toEqual(["live"])

    const forAdmin = listActiveAnnouncements("u1", true, new Date())
    expect(forAdmin.map((a) => a.title).sort()).toEqual(["admin-only", "live"])
    expect(live.id).toBeTruthy()
  })

  it("excludes announcements dismissed by the user but not others", () => {
    clearAnnouncementsForTests()
    const announcement = createAnnouncement(input())
    dismissAnnouncement("u1", announcement.id)

    expect(listActiveAnnouncements("u1", false, new Date())).toEqual([])
    expect(listActiveAnnouncements("u2", false, new Date())).toHaveLength(1)
  })

  it("is sorted newest publishedAt first", () => {
    clearAnnouncementsForTests()
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date("2026-02-01T10:00:00.000Z"))
      const first = createAnnouncement(
        input({ title: "first", startsAt: "2020-01-01T00:00:00.000Z" }),
      )
      vi.setSystemTime(new Date("2026-02-01T11:00:00.000Z"))
      const second = createAnnouncement(
        input({ title: "second", startsAt: "2020-01-01T00:00:00.000Z" }),
      )
      const farFuture = new Date("2027-01-01T00:00:00.000Z")
      expect(listActiveAnnouncements("u", false, farFuture).map((a) => a.id)).toEqual([
        second.id,
        first.id,
      ])
    } finally {
      vi.useRealTimers()
    }
  })
})

describe("dismissAnnouncement", () => {
  it("is idempotent", () => {
    clearAnnouncementsForTests()
    const announcement = createAnnouncement(input())
    dismissAnnouncement("u1", announcement.id)
    dismissAnnouncement("u1", announcement.id)
    dismissAnnouncement("u1", "ann_missing")
    expect(listActiveAnnouncements("u1", false, new Date())).toEqual([])
  })
})

describe("listAllAnnouncements", () => {
  it("returns every record including scheduled and expired", () => {
    clearAnnouncementsForTests()
    createAnnouncement(input({ title: "live" }))
    createAnnouncement(input({ title: "scheduled", startsAt: FUTURE }))
    createAnnouncement(input({ title: "expired", startsAt: EXPIRED_START, endsAt: EXPIRED_END }))

    const all = listAllAnnouncements()
    expect(all).toHaveLength(3)
    expect(all.map((a) => a.title).sort()).toEqual(["expired", "live", "scheduled"])
  })
})

describe("store bounds", () => {
  it("evicts the oldest announcement beyond the cap", () => {
    clearAnnouncementsForTests()
    for (let i = 0; i < ANNOUNCEMENTS_STORE_MAX + 5; i += 1) {
      createAnnouncement(input({ title: `a${i}` }))
    }
    const all = listAllAnnouncements()
    expect(all).toHaveLength(ANNOUNCEMENTS_STORE_MAX)
    expect(all.some((a) => a.title === "a0")).toBe(false)
  })
})
