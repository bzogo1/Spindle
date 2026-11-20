import { beforeEach, describe, expect, it } from "vitest"

import {
  PERSONALIZATION_STORAGE_KEY,
  clearPersonalization,
  personalizationScore,
  personalizationScoreFromEntry,
  readPersonalizationMap,
  recordSearchClick,
  recordSearchView,
} from "./personalization"

beforeEach(() => {
  window.localStorage.clear()
})

describe("personalization tracking", () => {
  it("records clicks and views separately", () => {
    const now = 1_000_000
    recordSearchClick("item:a", now)
    recordSearchClick("item:a", now + 1000)
    recordSearchView("item:a", now + 2000)
    recordSearchView("item:b", now + 2000)

    const map = readPersonalizationMap(now + 3000)
    expect(map.get("item:a")).toMatchObject({ clicks: 2, views: 1 })
    expect(map.get("item:b")).toMatchObject({ clicks: 0, views: 1 })
    expect(window.localStorage.getItem(PERSONALIZATION_STORAGE_KEY)).toContain("item:a")
  })

  it("scores clicked items above view-only and unseen items", () => {
    const now = Date.now()
    recordSearchClick("clicked", now)
    recordSearchView("viewed", now)

    expect(personalizationScore("clicked", now)).toBeGreaterThan(
      personalizationScore("viewed", now),
    )
    expect(personalizationScore("viewed", now)).toBeGreaterThan(personalizationScore("unseen", now))
    expect(personalizationScore("unseen", now)).toBe(0)
  })

  it("decays with age — stale clicks score lower", () => {
    const now = Date.now()
    const old = now - 60 * 24 * 60 * 60 * 1000 // 60 days ago
    recordSearchClick("stale", old)
    recordSearchClick("fresh", now)

    expect(personalizationScore("fresh", now)).toBeGreaterThan(personalizationScore("stale", now))
  })

  it("saturates frequency so one viral item cannot dominate forever", () => {
    const now = Date.now()
    const entry = { clicks: 10, lastClick: now, views: 0, lastView: 0 }
    const viral = personalizationScoreFromEntry(entry, now)
    expect(viral).toBeLessThanOrEqual(1)
    // 10 clicks at max recency ≈ clickPart*0.75 = 0.75
    expect(viral).toBeCloseTo(0.75, 1)
  })

  it("clearPersonalization wipes the store", () => {
    recordSearchClick("item:a")
    clearPersonalization()
    expect(readPersonalizationMap()).toHaveLength(0)
    expect(window.localStorage.getItem(PERSONALIZATION_STORAGE_KEY)).toBeNull()
  })
})
