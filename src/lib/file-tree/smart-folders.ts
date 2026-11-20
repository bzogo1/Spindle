/**
 * "Smart folder" helpers: synthetic dir nodes that surface annotated nodes
 * (recent files, bookmarks, favorites, collections) at the top of the tree.
 *
 * Smart folders are VIEW-ONLY: their children are references to the real
 * nodes (same ids), so selection/activation work normally, but mutating ops
 * (move/rename) should target the real node — the folder itself is marked
 * with `data.smartFolder = true` so the UI can hide mutating affordances.
 */

import { createNode, findNode, type FileTreeNode } from "./tree"

export interface SmartFolderSpec {
  /** Unique id for the synthetic folder, e.g. "smart-recent". */
  id: string
  name: string
  /** Node ids to surface, in display order. Missing ids are skipped. */
  nodeIds: string[]
}

export function isSmartFolder(node: FileTreeNode): boolean {
  return Boolean((node.data as { smartFolder?: boolean } | undefined)?.smartFolder)
}

/**
 * Build a synthetic dir node whose children are the referenced nodes
 * (cloned shallowly via structuredClone so `data` payloads stay intact).
 * Children keep their original ids — the folder is a lens, not a copy.
 */
export function buildSmartFolder(tree: FileTreeNode, spec: SmartFolderSpec): FileTreeNode {
  const children: FileTreeNode[] = []
  spec.nodeIds.forEach((id, index) => {
    const node = findNode(tree, id)
    if (!node || node.id === tree.id) return
    const clone = structuredClone(node)
    clone.order = index
    children.push(clone)
  })
  return createNode({
    id: spec.id,
    name: spec.name,
    type: "dir",
    order: -1, // smart folders sort before real children
    children,
    data: { smartFolder: true, spec },
  })
}

/**
 * Return a new tree whose root children are `folders` followed by the
 * original children. The input tree is not mutated.
 */
export function withSmartFolders(tree: FileTreeNode, folders: FileTreeNode[]): FileTreeNode {
  const next = structuredClone(tree)
  next.children = [...folders, ...next.children]
  next.children.forEach((child, index) => {
    child.order = index
  })
  return next
}

/** Convenience: recent-files smart folder from a recents id list. */
export function recentFolder(tree: FileTreeNode, ids: string[], name = "Recent"): FileTreeNode {
  return buildSmartFolder(tree, { id: "smart-recent", name, nodeIds: ids })
}

export function bookmarkFolder(
  tree: FileTreeNode,
  ids: string[],
  name = "Bookmarks",
): FileTreeNode {
  return buildSmartFolder(tree, { id: "smart-bookmarks", name, nodeIds: ids })
}

export function favoriteFolder(
  tree: FileTreeNode,
  ids: string[],
  name = "Favorites",
): FileTreeNode {
  return buildSmartFolder(tree, { id: "smart-favorites", name, nodeIds: ids })
}
