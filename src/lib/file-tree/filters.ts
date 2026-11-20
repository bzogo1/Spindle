/**
 * Declarative filters for the file tree (bookmarks / recents / favorites /
 * tags). A filter is a predicate over node ids; `applyTreeFilter` keeps
 * matching nodes AND their ancestors so the filtered view stays a valid
 * tree (parents render even when they don't match themselves).
 */

import { getNodePath, visibleItems, type FileTreeNode, type VisibleTreeItem } from "./tree"

export interface TreeFilter {
  bookmarkOnly?: boolean
  favoriteOnly?: boolean
  recentOnly?: boolean
  /** Node must carry at least one of these tag ids. */
  tagIds?: string[]
}

export function isFilterActive(filter: TreeFilter | null | undefined): boolean {
  if (!filter) return false
  return Boolean(
    filter.bookmarkOnly ||
    filter.favoriteOnly ||
    filter.recentOnly ||
    (filter.tagIds && filter.tagIds.length > 0),
  )
}

export interface FilterSources {
  isBookmarked?: (id: string) => boolean
  isFavorite?: (id: string) => boolean
  isRecent?: (id: string) => boolean
  /** Tag ids assigned to a node. */
  tagIdsFor?: (id: string) => string[]
}

/** True when `nodeId` satisfies every enabled clause of `filter`. */
export function nodeMatchesFilter(
  nodeId: string,
  filter: TreeFilter,
  sources: FilterSources,
): boolean {
  if (filter.bookmarkOnly && !sources.isBookmarked?.(nodeId)) return false
  if (filter.favoriteOnly && !sources.isFavorite?.(nodeId)) return false
  if (filter.recentOnly && !sources.isRecent?.(nodeId)) return false
  if (filter.tagIds && filter.tagIds.length > 0) {
    const nodeTags = sources.tagIdsFor?.(nodeId) ?? []
    if (!filter.tagIds.some((tagId) => nodeTags.includes(tagId))) return false
  }
  return true
}

/**
 * Filter the visible rows of `tree`: a row survives when it matches the
 * filter or is an ancestor of a match (so parents stay visible).
 * Returns the filtered rows in display order.
 */
export function filterVisibleItems(
  tree: FileTreeNode,
  isExpanded: (id: string) => boolean,
  filter: TreeFilter | null | undefined,
  sources: FilterSources,
): VisibleTreeItem[] {
  const rows = visibleItems(tree, isExpanded)
  if (!isFilterActive(filter)) return rows

  const keep = new Set<string>()
  for (const row of rows) {
    if (nodeMatchesFilter(row.node.id, filter!, sources)) {
      keep.add(row.node.id)
      const path = getNodePath(tree, row.node.id)
      if (path) {
        // Keep ancestors so the match stays reachable in the filtered view.
        for (let i = 0; i < path.length - 1; i += 1) keep.add(path[i].id)
      }
    }
  }
  return rows.filter((row) => keep.has(row.node.id))
}

/**
 * Dir ids that must be expanded for every filter match to be visible —
 * i.e. the ancestors of all matching nodes, searched over the WHOLE tree
 * (matches inside collapsed dirs still count). The tree root is included;
 * callers already treat it as always-expanded. Empty set when no filter
 * is active.
 */
export function filterExpandedIds(
  tree: FileTreeNode,
  filter: TreeFilter | null | undefined,
  sources: FilterSources,
): Set<string> {
  const ids = new Set<string>()
  if (!isFilterActive(filter)) return ids
  const walk = (node: FileTreeNode) => {
    if (node.id !== tree.id && nodeMatchesFilter(node.id, filter!, sources)) {
      const path = getNodePath(tree, node.id)
      if (path) {
        for (let i = 0; i < path.length - 1; i += 1) ids.add(path[i].id)
      }
    }
    node.children.forEach(walk)
  }
  walk(tree)
  return ids
}
