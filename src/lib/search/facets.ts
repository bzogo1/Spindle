import type { SearchItem } from "./index"
import { searchItemSection, searchItemTags, searchItemType } from "./filters"

/**
 * Faceted counts for search results. Facets are computed over the *unfiltered*
 * result set so every dimension stays explorable while a filter is active —
 * the classic "counts next to results" behavior. Clicking a facet value maps
 * to a `SearchFilters` entry via `facetToFilters`.
 */

export type FacetDimension = "type" | "section" | "tag"

export type FacetCount = {
  /** The raw facet value (type key, section name, or tag). */
  value: string
  /** Number of items carrying this value. */
  count: number
}

export type SearchFacets = Record<FacetDimension, FacetCount[]>

function countBy(items: SearchItem[], pick: (item: SearchItem) => string[]): FacetCount[] {
  const counts = new Map<string, number>()
  for (const item of items) {
    for (const value of pick(item)) {
      if (!value) continue
      counts.set(value, (counts.get(value) ?? 0) + 1)
    }
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
}

/** Facet counts for one dimension over a set of items. */
export function computeFacetCounts(items: SearchItem[], dimension: FacetDimension): FacetCount[] {
  switch (dimension) {
    case "type":
      return countBy(items, (item) => [searchItemType(item)])
    case "section":
      return countBy(items, (item) => [searchItemSection(item)])
    case "tag":
      return countBy(items, searchItemTags)
  }
}

/** All facet dimensions at once — the shape the filter UI consumes. */
export function computeSearchFacets(items: SearchItem[]): SearchFacets {
  return {
    type: computeFacetCounts(items, "type"),
    section: computeFacetCounts(items, "section"),
    tag: computeFacetCounts(items, "tag"),
  }
}

/**
 * Map a facet click to the corresponding `SearchFilters` patch. Selecting
 * the already-active value clears that dimension (toggle behavior).
 */
export function facetToFilters(
  dimension: FacetDimension,
  value: string,
  current: { types?: string[]; sections?: string[]; tags?: string[] },
): { types?: string[]; sections?: string[]; tags?: string[] } {
  const key = dimension === "type" ? "types" : dimension === "section" ? "sections" : "tags"
  const active = current[key] ?? []
  const next = active.includes(value) ? active.filter((v) => v !== value) : [...active, value]
  return { ...current, [key]: next.length > 0 ? next : undefined }
}
