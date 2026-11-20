import { describe, expect, it } from "vitest"

import type { SearchItem } from "./index"
import { computeFacetCounts, computeSearchFacets, facetToFilters } from "./facets"

function item(partial: Partial<SearchItem> & Pick<SearchItem, "id" | "title">): SearchItem {
  return { group: "Pages", ...partial }
}

const items: SearchItem[] = [
  item({ id: "page:/a", title: "A", type: "page", section: "Product", tags: ["x", "y"] }),
  item({ id: "page:/b", title: "B", type: "page", section: "Product", tags: ["x"] }),
  item({ id: "doc:g:s", title: "C", type: "doc", section: "Guides", tags: ["y"] }),
  item({ id: "api:thing", title: "D", type: "api", section: "Guides" }),
]

describe("computeFacetCounts", () => {
  it("counts types, sections, and tags with derived fallbacks", () => {
    expect(computeFacetCounts(items, "type")).toEqual([
      { value: "page", count: 2 },
      { value: "api", count: 1 },
      { value: "doc", count: 1 },
    ])
    expect(computeFacetCounts(items, "section")).toEqual([
      { value: "Guides", count: 2 },
      { value: "Product", count: 2 },
    ])
    expect(computeFacetCounts(items, "tag")).toEqual([
      { value: "x", count: 2 },
      { value: "y", count: 2 },
    ])
  })

  it("computes all dimensions at once", () => {
    const facets = computeSearchFacets(items)
    expect(facets.type).toHaveLength(3)
    expect(facets.section).toHaveLength(2)
    expect(facets.tag).toHaveLength(2)
  })
})

describe("facetToFilters", () => {
  it("toggles values on and off", () => {
    const on = facetToFilters("type", "doc", { types: ["page"] })
    expect(on.types).toEqual(["page", "doc"])
    const off = facetToFilters("type", "page", on)
    expect(off.types).toEqual(["doc"])
    const cleared = facetToFilters("type", "doc", { types: ["doc"] })
    expect(cleared.types).toBeUndefined()
  })

  it("maps section and tag dimensions to their filter keys", () => {
    expect(facetToFilters("section", "Guides", {}).sections).toEqual(["Guides"])
    expect(facetToFilters("tag", "x", {}).tags).toEqual(["x"])
  })
})
