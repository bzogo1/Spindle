import type { SearchHit, SearchItem } from "./index"

/**
 * Result filters for search (type / section / tag / last-updated).
 *
 * `SearchItem` carries optional `type`, `section`, `tags`, and `updatedAt`
 * metadata; when absent, `type` is derived from the item id prefix
 * (`page:`, `doc:`, `project:`, …) or its group label, `section` falls back
 * to the group, and `tags` is empty. Date filters only keep items that
 * actually carry an `updatedAt` — an undated item cannot satisfy
 * "updated within N days".
 */

export type SearchFilters = {
  /** Keep only these item types (see `searchItemType`). Empty/undefined = all. */
  types?: readonly string[]
  /** Keep only these sections (see `searchItemSection`). */
  sections?: readonly string[]
  /** Keep items tagged with at least one of these tags. */
  tags?: readonly string[]
  /** Keep items last updated at/after this epoch-ms timestamp. */
  updatedAfter?: number
  /** Keep items last updated at/before this epoch-ms timestamp. */
  updatedBefore?: number
}

const TYPE_FROM_PREFIX: ReadonlyArray<readonly [string, string]> = [
  ["page:", "page"],
  ["doc:", "doc"],
  ["api:", "api"],
  ["project:", "project"],
  ["file:", "file"],
  ["changelog:", "changelog"],
  ["action:", "action"],
  ["workspace:", "workspace"],
]

const TYPE_FROM_GROUP: Record<string, string> = {
  Pages: "page",
  Docs: "doc",
  Projects: "project",
  Files: "file",
  Changelog: "changelog",
  Actions: "action",
  Workspaces: "workspace",
}

/** The filterable "type" of a search item: explicit `type`, id prefix, or group. */
export function searchItemType(item: SearchItem): string {
  if (item.type) return item.type
  for (const [prefix, type] of TYPE_FROM_PREFIX) {
    if (item.id.startsWith(prefix)) return type
  }
  return TYPE_FROM_GROUP[item.group] ?? item.group.toLowerCase()
}

/** The filterable "section" of a search item: explicit `section` or its group. */
export function searchItemSection(item: SearchItem): string {
  return item.section ?? item.group
}

/** Tags declared on the item (empty when absent). */
export function searchItemTags(item: SearchItem): string[] {
  return item.tags ?? []
}

/**
 * Last-updated time in epoch ms. Accepts a number (epoch ms or seconds —
 * values below 1e12 are treated as seconds) or an ISO/date string. Returns 0
 * when the item carries no usable date.
 */
export function searchItemUpdatedAt(item: SearchItem): number {
  const value = item.updatedAt
  if (typeof value === "number" && Number.isFinite(value)) {
    return value < 1e12 ? value * 1000 : value
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value)
    return Number.isNaN(parsed) ? 0 : parsed
  }
  return 0
}

/** True when `filters` constrains anything at all. */
export function hasActiveFilters(filters: SearchFilters | undefined): boolean {
  if (!filters) return false
  return Boolean(
    filters.types?.length ||
    filters.sections?.length ||
    filters.tags?.length ||
    filters.updatedAfter !== undefined ||
    filters.updatedBefore !== undefined,
  )
}

/** Whether a single item satisfies every active filter dimension. */
export function matchesSearchFilters(item: SearchItem, filters: SearchFilters): boolean {
  if (filters.types?.length && !filters.types.includes(searchItemType(item))) return false
  if (filters.sections?.length && !filters.sections.includes(searchItemSection(item))) return false
  if (filters.tags?.length) {
    const itemTags = searchItemTags(item)
    if (!filters.tags.some((tag) => itemTags.includes(tag))) return false
  }
  if (filters.updatedAfter !== undefined || filters.updatedBefore !== undefined) {
    const updatedAt = searchItemUpdatedAt(item)
    if (updatedAt === 0) return false
    if (filters.updatedAfter !== undefined && updatedAt < filters.updatedAfter) return false
    if (filters.updatedBefore !== undefined && updatedAt > filters.updatedBefore) return false
  }
  return true
}

/** Filter a ranked hit list, preserving order. */
export function applySearchFilters(hits: SearchHit[], filters: SearchFilters): SearchHit[] {
  if (!hasActiveFilters(filters)) return hits
  return hits.filter((hit) => matchesSearchFilters(hit.item, filters))
}

/**
 * Stable serialization of the filter-relevant parts of a config — used in
 * cache keys and effect deps so filter changes invalidate correctly.
 */
export function filtersKey(filters: SearchFilters | undefined): string {
  if (!filters) return ""
  const normalize = (values: readonly string[] | undefined) =>
    values && values.length > 0 ? [...values].sort().join(",") : ""
  return [
    normalize(filters.types),
    normalize(filters.sections),
    normalize(filters.tags),
    filters.updatedAfter ?? "",
    filters.updatedBefore ?? "",
  ].join("|")
}
