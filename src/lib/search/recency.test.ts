import { beforeEach, describe, expect, it } from "vitest"

import { frecency, readRecencyMap, recentIds, recordUse, RECENTS_STORAGE_KEY } from "./recency"

const NOW = Date.parse("2026-11-19T12:00:00.000Z")
const DAY = 24 * 60 * 60 * 1000

describe("recency store", () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it("returns an empty map when nothing is stored", () => {
    expect(readRecencyMap(NOW).size).toBe(0)
    expect(frecency("page:/x", NOW)).toBe(0)
    expect(recentIds(5, NOW)).toEqual([])
  })

  it("recordUse increments count and stamps lastUsed", () => {
    recordUse("page:/a", NOW - 1000)
    recordUse("page:/a", NOW)

    const entry = readRecencyMap(NOW).get("page:/a")
    expect(entry).toEqual({ count: 2, lastUsed: NOW })
  })

  it("migrates the legacy string-array format", () => {
    window.localStorage.setItem(RECENTS_STORAGE_KEY, JSON.stringify(["page:/old", "page:/older"]))

    const map = readRecencyMap(NOW)
    expect(map.get("page:/old")?.count).toBe(1)
    expect(map.has("page:/older")).toBe(true)
    expect(recentIds(5, NOW)[0]).toBe("page:/old")
  })

  it("frecency decays with age", () => {
    recordUse("page:/fresh", NOW)
    recordUse("page:/stale", NOW - 30 * DAY)

    expect(frecency("page:/fresh", NOW)).toBeGreaterThan(frecency("page:/stale", NOW))
    expect(frecency("page:/stale", NOW)).toBeGreaterThan(0)
  })

  it("recentIds orders by frecency and respects the limit", () => {
    recordUse("page:/a", NOW - 10 * DAY)
    recordUse("page:/b", NOW)
    recordUse("page:/c", NOW - DAY)
    recordUse("page:/c", NOW - DAY + 1)

    const ids = recentIds(2, NOW)
    expect(ids).toHaveLength(2)
    expect(ids[0]).toBe("page:/c") // most frequent and recent
    expect(ids).not.toContain("page:/a")
  })
})
