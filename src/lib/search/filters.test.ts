import { beforeEach, describe, expect, it } from "vitest"

import type { SearchHit, SearchItem } from "./index"
import {
  applySearchFilters,
  filtersKey,
  hasActiveFilters,
  matchesSearchFilters,
  searchItemSection,
  searchItemType,
  searchItemUpdatedAt,
  type SearchFilters,
} from "./filters"

function item(partial: Partial<SearchItem> & Pick<SearchItem, "id" | "title">): SearchItem {
  return { group: "Pages", ...partial }
}

function hit(searchItem: SearchItem, score = 0): SearchHit {
  return { item: searchItem, score }
}

beforeEach(() => {
  window.localStorage.clear()
})

describe("searchItemType", () => {
  it("prefers explicit type, then id prefix, then group", () => {
    expect(searchItemType(item({ id: "x", title: "T", type: "api" }))).toBe("api")
    expect(searchItemType(item({ id: "doc:guide:sec", title: "T" }))).toBe("doc")
    expect(searchItemType(item({ id: "custom", title: "T", group: "Docs" }))).toBe("doc")
    expect(searchItemType(item({ id: "custom", title: "T", group: "Whatever" }))).toBe("whatever")
  })
})

describe("searchItemUpdatedAt", () => {
  it("parses numbers (s and ms) and date strings", () => {
    expect(searchItemUpdatedAt(item({ id: "a", title: "A", updatedAt: 1_700_000_000 }))).toBe(
      1_700_000_000_000,
    )
    expect(searchItemUpdatedAt(item({ id: "b", title: "B", updatedAt: 1_700_000_000_000 }))).toBe(
      1_700_000_000_000,
    )
    expect(searchItemUpdatedAt(item({ id: "c", title: "C", updatedAt: "2026-01-15" }))).toBe(
      Date.parse("2026-01-15"),
    )
    expect(searchItemUpdatedAt(item({ id: "d", title: "D" }))).toBe(0)
  })
})

describe("matchesSearchFilters", () => {
  const docs = item({
    id: "doc:g:s",
    title: "Doc",
    group: "Docs",
    section: "Guides",
    tags: ["guide"],
    updatedAt: 1_700_000_000_000,
  })
  const page = item({
    id: "page:/",
    title: "Home",
    group: "Pages",
    section: "Product",
    updatedAt: 1_800_000_000_000,
  })

  it("filters by type", () => {
    const filters: SearchFilters = { types: ["doc"] }
    expect(matchesSearchFilters(docs, filters)).toBe(true)
    expect(matchesSearchFilters(page, filters)).toBe(false)
  })

  it("filters by section and tags", () => {
    expect(matchesSearchFilters(docs, { sections: ["Guides"] })).toBe(true)
    expect(matchesSearchFilters(docs, { sections: ["Product"] })).toBe(false)
    expect(matchesSearchFilters(docs, { tags: ["guide"] })).toBe(true)
    expect(matchesSearchFilters(docs, { tags: ["other"] })).toBe(false)
  })

  it("filters by updated range and excludes undated items", () => {
    const undated = item({ id: "x", title: "X" })
    expect(matchesSearchFilters(docs, { updatedAfter: 1_600_000_000_000 })).toBe(true)
    expect(matchesSearchFilters(docs, { updatedAfter: 1_750_000_000_000 })).toBe(false)
    expect(matchesSearchFilters(docs, { updatedBefore: 1_750_000_000_000 })).toBe(true)
    expect(matchesSearchFilters(undated, { updatedAfter: 0 })).toBe(false)
  })

  it("hasActiveFilters and applySearchFilters", () => {
    expect(hasActiveFilters(undefined)).toBe(false)
    expect(hasActiveFilters({})).toBe(false)
    expect(hasActiveFilters({ types: ["doc"] })).toBe(true)

    const hits = [hit(docs, 1), hit(page, 2)]
    expect(applySearchFilters(hits, { types: ["doc"] }).map((h) => h.item.id)).toEqual(["doc:g:s"])
    expect(applySearchFilters(hits, {})).toHaveLength(2)
  })

  it("searchItemSection falls back to group", () => {
    expect(searchItemSection(item({ id: "a", title: "A" }))).toBe("Pages")
    expect(searchItemSection(item({ id: "b", title: "B", section: "Custom" }))).toBe("Custom")
  })

  it("filtersKey is stable regardless of selection order", () => {
    expect(filtersKey({ types: ["b", "a"] })).toBe(filtersKey({ types: ["a", "b"] }))
    expect(filtersKey(undefined)).toBe("")
  })
})
