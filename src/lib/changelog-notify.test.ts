import { beforeEach, describe, expect, it } from "vitest"

import { changelogReleases } from "@/lib/changelog"
import { clearInAppMessages, listInbox } from "@/lib/in-app-messages"

import {
  clearChangelogNotifyState,
  getChangelogEntries,
  getLastSeenDate,
  getUnseenEntries,
  markChangelogSeen,
  notifyNewEntries,
} from "./changelog-notify"

// The fixture release is dated 2026-11-19; `now` values straddle it.
const BEFORE = new Date("2026-11-18T00:00:00Z")
const AFTER = new Date("2026-11-20T00:00:00Z")

beforeEach(() => {
  clearChangelogNotifyState()
  clearInAppMessages()
})

describe("getChangelogEntries", () => {
  it("maps releases newest-first with stable ids and urls", () => {
    const entries = getChangelogEntries()
    expect(entries.length).toBe(changelogReleases.length)
    expect(entries[0].id).toBe(changelogReleases[0].slug)
    expect(entries[0].url).toBe(`/changelog/${changelogReleases[0].slug}`)
    for (let i = 1; i < entries.length; i += 1) {
      expect(entries[i - 1].date >= entries[i].date).toBe(true)
    }
  })
})

describe("getUnseenEntries", () => {
  it("returns every published entry for a user who never marked seen", () => {
    const unseen = getUnseenEntries("user-1", AFTER)
    expect(unseen.map((e) => e.id)).toEqual(changelogReleases.map((r) => r.slug))
  })

  it("excludes entries dated after `now`", () => {
    expect(getUnseenEntries("user-1", BEFORE)).toEqual([])
  })

  it("returns nothing once the user marked everything seen", () => {
    markChangelogSeen("user-1", null, AFTER)
    expect(getUnseenEntries("user-1", AFTER)).toEqual([])
    expect(getLastSeenDate("user-1")).toBe(changelogReleases[0].date)
  })
})

describe("markChangelogSeen", () => {
  it("advances last-seen to a specific entry's date", () => {
    const entry = getChangelogEntries()[0]
    const result = markChangelogSeen("user-1", entry.id, AFTER)
    expect(result).toEqual({ marked: true, lastSeen: entry.date })
    expect(getUnseenEntries("user-1", AFTER)).toEqual([])
  })

  it("never moves last-seen backwards", () => {
    const entries = getChangelogEntries()
    const newest = entries[0]
    const oldest = entries[entries.length - 1]
    markChangelogSeen("user-1", null, AFTER)
    const result = markChangelogSeen("user-1", oldest.id, AFTER)
    expect(result.lastSeen).toBe(newest.date)
  })

  it("returns marked:false for an unknown entry id", () => {
    const result = markChangelogSeen("user-1", "nope", AFTER)
    expect(result.marked).toBe(false)
    expect(getLastSeenDate("user-1")).toBeNull()
  })

  it("rejects future-dated entry ids so lastSeen cannot jump ahead", () => {
    const base = changelogReleases[0]
    const future = {
      ...base,
      slug: "future-release",
      version: "9.9",
      date: "2027-06-01",
      title: "Future release",
    }
    changelogReleases.unshift(future)
    try {
      const result = markChangelogSeen("user-1", future.slug, AFTER)
      expect(result.marked).toBe(false)
      expect(getLastSeenDate("user-1")).toBeNull()
      // The real published entries are still unseen — nothing was suppressed.
      expect(getUnseenEntries("user-1", AFTER).length).toBe(changelogReleases.length - 1)
    } finally {
      changelogReleases.splice(changelogReleases.indexOf(future), 1)
    }
  })

  it("keeps seen state per user", () => {
    markChangelogSeen("user-1", null, AFTER)
    expect(getUnseenEntries("user-2", AFTER).length).toBe(changelogReleases.length)
  })
})

describe("notifyNewEntries", () => {
  it("broadcasts one info message per unpublished-then-published entry", () => {
    const result = notifyNewEntries(AFTER)
    expect(result.sent).toBe(changelogReleases.length)
    expect(result.skipped).toBe(0)

    const inbox = listInbox("any-user")
    expect(inbox).toHaveLength(changelogReleases.length)
    const first = inbox.find((m) => m.subject.includes(changelogReleases[0].title))
    expect(first?.kind).toBe("info")
    expect(first?.userId).toBeNull()
  })

  it("is idempotent — a second run sends nothing", () => {
    notifyNewEntries(AFTER)
    const second = notifyNewEntries(AFTER)
    expect(second.sent).toBe(0)
    expect(second.skipped).toBe(changelogReleases.length)
    expect(listInbox("any-user")).toHaveLength(changelogReleases.length)
  })

  it("skips entries dated after now", () => {
    const result = notifyNewEntries(BEFORE)
    expect(result.sent).toBe(0)
    expect(listInbox("any-user")).toHaveLength(0)
  })
})
