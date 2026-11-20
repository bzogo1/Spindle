/**
 * Pure, immutable file-tree model and mutation operations.
 *
 * The tree is a single root node (`type: "dir"`) whose `children` arrays
 * define display order. Sibling order is stored redundantly on each node's
 * `order` field (dense, 0..n-1) so consumers can sort or serialize without
 * relying on array position; every mutating op re-normalizes it.
 *
 * All operations are pure: they return a new tree and never mutate the input.
 * Nodes may carry an opaque `data` payload (e.g. a domain `FileNode`); it must
 * be structured-cloneable because ops deep-clone via `structuredClone`.
 */

export type FileTreeNodeType = "file" | "dir"

export interface FileTreeNode {
  id: string
  name: string
  type: FileTreeNodeType
  /** Dense sibling order (0-based). Maintained by all mutating ops. */
  order: number
  children: FileTreeNode[]
  /** Optional monotonic version stamp, useful for last-write-wins merges. */
  version?: number
  /** Optional ISO timestamp of last mutation. */
  updatedAt?: string
  /** Opaque payload preserved verbatim across tree operations. */
  data?: unknown
}

/** Where a dragged/dropped node should land. `newParentId: null` = tree root. */
export interface MoveNodeInput {
  nodeId: string
  newParentId: string | null
  /**
   * Final index inside the destination's children, counted *after* the node
   * has been removed from its current parent (0..children.length).
   * `undefined` appends to the end.
   */
  index?: number
}

export type TreeResult<T> = { ok: true; value: T } | { ok: false; error: string }

const ok = <T>(value: T): TreeResult<T> => ({ ok: true, value })
const err = <T>(error: string): TreeResult<T> => ({ ok: false, error })

export function createNode(
  partial: Pick<FileTreeNode, "id" | "name" | "type"> & Partial<FileTreeNode>,
): FileTreeNode {
  return {
    order: 0,
    children: [],
    ...partial,
  }
}

/** Deep clone. Nodes (including `data`) must be structured-cloneable. */
export function cloneTree(tree: FileTreeNode): FileTreeNode {
  return structuredClone(tree)
}

function normalizeOrders(children: FileTreeNode[]) {
  children.forEach((child, index) => {
    child.order = index
  })
}

/** Find a node by id, or null. */
export function findNode(tree: FileTreeNode, id: string): FileTreeNode | null {
  if (tree.id === id) return tree
  for (const child of tree.children) {
    const found = findNode(child, id)
    if (found) return found
  }
  return null
}

/**
 * Ancestor chain from the root down to and including `id`, or null.
 * The first element is always the tree root.
 */
export function getNodePath(tree: FileTreeNode, id: string): FileTreeNode[] | null {
  if (tree.id === id) return [tree]
  for (const child of tree.children) {
    const path = getNodePath(child, id)
    if (path) return [tree, ...path]
  }
  return null
}

/** Ids of `nodeId`'s ancestors, root-first (excludes the node itself). */
export function ancestorIds(tree: FileTreeNode, nodeId: string): string[] {
  const path = getNodePath(tree, nodeId)
  if (!path) return []
  return path.slice(0, -1).map((node) => node.id)
}

/**
 * True when `descendantId` sits strictly inside `ancestorId`'s subtree
 * (the ancestor itself does not count).
 */
export function isDescendantOf(
  tree: FileTreeNode,
  ancestorId: string,
  descendantId: string,
): boolean {
  const ancestor = findNode(tree, ancestorId)
  if (!ancestor || ancestor.type !== "dir") return false
  const walk = (node: FileTreeNode): boolean =>
    node.children.some((child) => child.id === descendantId || walk(child))
  return walk(ancestor)
}

/**
 * Move `nodeId` under `newParentId` (`null` = tree root) at `index`.
 *
 * Validation (all return `{ ok: false }` without touching the input):
 * - node or destination missing
 * - destination is not a dir
 * - node is the root
 * - destination is the node itself or one of its descendants (cycle)
 *
 * `index` is interpreted in post-removal coordinates; it is clamped to
 * `[0, destination.children.length]`.
 */
export function move(
  tree: FileTreeNode,
  nodeId: string,
  newParentId: string | null,
  index?: number,
): TreeResult<FileTreeNode> {
  if (nodeId === tree.id) return err("The root node cannot be moved.")

  const next = cloneTree(tree)
  const path = getNodePath(next, nodeId)
  if (!path) return err(`Node "${nodeId}" was not found.`)

  const node = path[path.length - 1]
  const oldParent = path.length > 1 ? path[path.length - 2] : null
  if (!oldParent) return err("The root node cannot be moved.")

  const destination =
    newParentId === null || newParentId === next.id ? next : findNode(next, newParentId)
  if (!destination) return err(`Destination "${newParentId}" was not found.`)
  if (destination.type !== "dir") return err(`"${destination.name}" is not a folder.`)
  if (destination.id === nodeId || isDescendantOf(next, nodeId, destination.id)) {
    return err(`Cannot move "${node.name}" into itself or its own descendants.`)
  }

  // Remove from the old parent, then insert into the destination. When both
  // are the same parent this yields a plain reorder.
  const fromIndex = oldParent.children.findIndex((child) => child.id === nodeId)
  const [removed] = oldParent.children.splice(fromIndex, 1)
  normalizeOrders(oldParent.children)

  const clamped =
    index === undefined
      ? destination.children.length
      : Math.max(0, Math.min(index, destination.children.length))
  destination.children.splice(clamped, 0, removed)
  normalizeOrders(destination.children)

  return ok(next)
}

/** Reorder `nodeId` within its current parent to `newIndex` (post-move coords). */
export function reorder(
  tree: FileTreeNode,
  nodeId: string,
  newIndex: number,
): TreeResult<FileTreeNode> {
  const parent = findParent(tree, nodeId)
  if (!parent) return err(`Node "${nodeId}" was not found.`)
  return move(tree, nodeId, parent.id, newIndex)
}

/** Direct parent of `id`, or null when `id` is the root or missing. */
export function findParent(tree: FileTreeNode, id: string): FileTreeNode | null {
  const path = getNodePath(tree, id)
  if (!path || path.length < 2) return null
  return path[path.length - 2]
}

/** `{ parentId, index }` of a node among its siblings. `parentId` null = root level. */
export function siblingPosition(
  tree: FileTreeNode,
  id: string,
): { parentId: string | null; index: number } | null {
  const parent = findParent(tree, id)
  if (!parent) return null
  const siblings = parent.id === tree.id ? tree.children : parent.children
  const index = siblings.findIndex((child) => child.id === id)
  if (index < 0) return null
  return { parentId: parent.id === tree.id ? null : parent.id, index }
}

/** Apply a batch of moves in order, skipping any that fail validation. */
export function applyMoves(
  tree: FileTreeNode,
  moves: MoveNodeInput[],
): { tree: FileTreeNode; applied: MoveNodeInput[]; skipped: MoveNodeInput[] } {
  let current = tree
  const applied: MoveNodeInput[] = []
  const skipped: MoveNodeInput[] = []
  for (const input of moves) {
    const result = move(current, input.nodeId, input.newParentId, input.index)
    if (result.ok) {
      current = result.value
      applied.push(input)
    } else {
      skipped.push(input)
    }
  }
  return { tree: current, applied, skipped }
}

export type DropPosition = "before" | "after" | "inside"

/**
 * Resolve a pointer drop (`dragId` over `overId` at `position`) into a
 * `MoveNodeInput`, or null when the drop is meaningless/invalid.
 *
 * - `inside` requires `overId` to be a dir and not inside `dragId`'s subtree.
 * - `before`/`after` keep the node under `overId`'s parent; they are rejected
 *   when that parent is `dragId` itself or one of its descendants (which would
 *   create a cycle), and when `overId === dragId`.
 *
 * The returned `index` is already in post-removal coordinates, so it can be
 * passed straight to `move()`.
 */
export function resolveDrop(
  tree: FileTreeNode,
  dragId: string,
  overId: string,
  position: DropPosition,
): MoveNodeInput | null {
  if (dragId === overId) return null
  const drag = findNode(tree, dragId)
  const over = findNode(tree, overId)
  if (!drag || !over) return null

  if (position === "inside") {
    if (over.type !== "dir") return null
    if (over.id === dragId || isDescendantOf(tree, dragId, over.id)) return null
    return { nodeId: dragId, newParentId: over.id }
  }

  const overParent = findParent(tree, overId)
  if (!overParent) return null // `over` is the root; can't drop beside it
  const newParentId = overParent.id === tree.id ? null : overParent.id
  if (
    newParentId !== null &&
    (newParentId === dragId || isDescendantOf(tree, dragId, newParentId))
  ) {
    return null
  }

  const siblings = overParent.id === tree.id ? tree.children : overParent.children
  const overIndex = siblings.findIndex((child) => child.id === overId)
  if (overIndex < 0) return null
  const dragPos = siblingPosition(tree, dragId)
  const sameParent = dragPos !== null && dragPos.parentId === newParentId
  let index = position === "before" ? overIndex : overIndex + 1
  if (sameParent && dragPos.index < index) index -= 1
  return { nodeId: dragId, newParentId, index }
}

export interface VisibleTreeItem {
  node: FileTreeNode
  depth: number
  /** null for the root item. */
  parentId: string | null
}

/**
 * Flatten the tree to the rows a user can currently see, in display order.
 * A dir's children are visible iff `isExpanded(dir.id)` is true; the root's
 * children are always visible.
 */
export function visibleItems(
  tree: FileTreeNode,
  isExpanded: (id: string) => boolean,
): VisibleTreeItem[] {
  const rows: VisibleTreeItem[] = []
  const walk = (node: FileTreeNode, depth: number, parentId: string | null) => {
    rows.push({ node, depth, parentId })
    if (node.type !== "dir") return
    const expanded = node.id === tree.id ? true : isExpanded(node.id)
    if (!expanded) return
    for (const child of [...node.children].sort((a, b) => a.order - b.order)) {
      walk(child, depth + 1, node.id)
    }
  }
  walk(tree, 0, null)
  return rows
}

/** Ids of every dir in the tree (used to default-expand). */
export function collectDirIds(tree: FileTreeNode): string[] {
  const ids: string[] = []
  const walk = (node: FileTreeNode) => {
    if (node.type === "dir") ids.push(node.id)
    node.children.forEach(walk)
  }
  walk(tree)
  return ids
}

/** Human-readable path of names from the root to `nodeId`. */
export function nodePath(tree: FileTreeNode, nodeId: string): string[] | null {
  const path = getNodePath(tree, nodeId)
  return path ? path.map((node) => node.name) : null
}
