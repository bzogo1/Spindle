import { beforeEach, describe, expect, it } from "vitest"

import type { SearchItem } from "./index"
import { SearchResultCache, hitsToCacheEntries, hydrateCachedHits, searchCacheKey } from "./cache"

function item(id: string, title = id): SearchItem {
  return { id, title, group: "Pages" }
}

beforeEach(() => {
  window.sessionStorage.clear()
})

describe("SearchResultCache", () => {
  it("stores and retrieves entries per key+version", () => {
    const cache = new SearchResultCache({ persist: false })
    cache.set("k1", 1, [{ id: "a", score: 1 }])
    expect(cache.get("k1", 1)).toEqual([{ id: "a", score: 1 }])
    expect(cache.get("k1", 2)).toBeNull() // version changed → invalidate
    expect(cache.get("other", 1)).toBeNull()
  })

  it("persists to sessionStorage and survives a new instance", () => {
    const first = new SearchResultCache({ storageKey: "test-cache" })
    first.set("k1", 7, [{ id: "a", score: 2 }])

    const second = new SearchResultCache({ storageKey: "test-cache" })
    expect(second.get("k1", 7)).toEqual([{ id: "a", score: 2 }])
    expect(second.get("k1", 8)).toBeNull()
  })

  it("evicts oldest entries beyond maxEntries (LRU)", () => {
    const cache = new SearchResultCache({ maxEntries: 2, persist: false })
    cache.set("a", 1, [])
    cache.set("b", 1, [])
    cache.get("a", 1) // refresh "a" — "b" is now oldest
    cache.set("c", 1, [])

    expect(cache.get("b", 1)).toBeNull()
    expect(cache.get("a", 1)).toEqual([])
    expect(cache.get("c", 1)).toEqual([])
    expect(cache.size).toBe(2)
  })

  it("clear() empties memory and storage", () => {
    const cache = new SearchResultCache({ storageKey: "test-cache-2" })
    cache.set("k", 1, [{ id: "a", score: 0 }])
    cache.clear()
    expect(cache.get("k", 1)).toBeNull()
    expect(window.sessionStorage.getItem("test-cache-2")).toBeNull()
  })
})

describe("cache helpers", () => {
  it("searchCacheKey is stable and distinguishes parts", () => {
    expect(searchCacheKey([1, "q", "r"])).toBe(searchCacheKey([1, "q", "r"]))
    expect(searchCacheKey([1, "q"])).not.toBe(searchCacheKey([1, "q", "r"]))
    expect(searchCacheKey([1, undefined, "r"])).toBe(searchCacheKey([1, "", "r"]))
  })

  it("hitsToCacheEntries strips icons; hydrateCachedHits rehydrates by id", () => {
    const items = [item("a", "Alpha"), item("b", "Beta")]
    const entries = hitsToCacheEntries([
      { item: items[0]!, score: 1 },
      { item: items[1]!, score: 2 },
    ])
    expect(entries).toEqual([
      { id: "a", score: 1 },
      { id: "b", score: 2 },
    ])

    // Item "b" vanished from the index → dropped on hydrate.
    const hits = hydrateCachedHits(entries, [items[0]!])
    expect(hits.map((h) => h.item.id)).toEqual(["a"])
    expect(hits[0]!.score).toBe(1)
  })
})
