/**
 * Local permission model for file-tree nodes.
 *
 * Roles are hierarchical: admin > editor > viewer. Permissions are assigned
 * per node id and inherit down the tree — a node's effective role is its own
 * assignment, or the nearest ancestor's, or the tree default.
 *
 * Enforcement helpers (`canMutate`, `canRename`, `canDelete`, `canMove`)
 * let the UI hide mutating affordances (read-only mode) and reject
 * interactions.
 */

import { findNode, getNodePath, type FileTreeNode } from "./tree"

export type TreeRole = "viewer" | "editor" | "admin"

export const ROLE_RANK: Record<TreeRole, number> = { viewer: 0, editor: 1, admin: 2 }

export function isRoleAtLeast(role: TreeRole, minimum: TreeRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minimum]
}

/** Map of nodeId -> role. Persisted by the caller (e.g. localStorage). */
export type PermissionMap = Record<string, TreeRole>

const PERMISSIONS_KEY = "spindle:tree-permissions"

export function loadPermissions(storage?: Pick<Storage, "getItem"> | null): PermissionMap {
  const store =
    storage === undefined ? (typeof localStorage !== "undefined" ? localStorage : null) : storage
  try {
    const raw = store?.getItem(PERMISSIONS_KEY)
    const parsed = raw ? JSON.parse(raw) : {}
    if (!parsed || typeof parsed !== "object") return {}
    const out: PermissionMap = {}
    for (const [id, role] of Object.entries(parsed)) {
      if (role === "viewer" || role === "editor" || role === "admin") out[id] = role
    }
    return out
  } catch {
    return {}
  }
}

export function savePermissions(
  map: PermissionMap,
  storage?: Pick<Storage, "setItem"> | null,
): void {
  const store =
    storage === undefined ? (typeof localStorage !== "undefined" ? localStorage : null) : storage
  try {
    store?.setItem(PERMISSIONS_KEY, JSON.stringify(map))
  } catch {
    // ignore quota errors
  }
}

/**
 * Effective role for `nodeId`: walk from the node up to the root and take
 * the nearest explicit assignment; fall back to `defaultRole` ("admin" —
 * unrestricted, matching pre-permission behavior).
 */
export function effectiveRole(
  tree: FileTreeNode,
  nodeId: string,
  permissions: PermissionMap,
  defaultRole: TreeRole = "admin",
): TreeRole {
  const path = getNodePath(tree, nodeId)
  if (!path) return defaultRole
  // Nearest assignment wins: iterate from the node itself upward.
  for (let i = path.length - 1; i >= 0; i -= 1) {
    const role = permissions[path[i].id]
    if (role) return role
  }
  return defaultRole
}

/** Roles that may perform structural mutations (move/rename/delete/create). */
export function canMutate(
  tree: FileTreeNode,
  nodeId: string,
  permissions: PermissionMap,
  defaultRole: TreeRole = "admin",
): boolean {
  return isRoleAtLeast(effectiveRole(tree, nodeId, permissions, defaultRole), "editor")
}

export function canRename(
  tree: FileTreeNode,
  nodeId: string,
  permissions: PermissionMap,
  defaultRole: TreeRole = "admin",
): boolean {
  return canMutate(tree, nodeId, permissions, defaultRole)
}

export function canDelete(
  tree: FileTreeNode,
  nodeId: string,
  permissions: PermissionMap,
  defaultRole: TreeRole = "admin",
): boolean {
  // Deleting requires editor on the node AND on its parent (you mutate the
  // parent's children list).
  if (!canMutate(tree, nodeId, permissions, defaultRole)) return false
  const path = getNodePath(tree, nodeId)
  if (!path || path.length < 2) return true
  const parentId = path[path.length - 2].id
  return canMutate(tree, parentId, permissions, defaultRole)
}

/** Moving requires edit rights on both the node and its destination parent. */
export function canMoveTo(
  tree: FileTreeNode,
  nodeId: string,
  newParentId: string | null,
  permissions: PermissionMap,
  defaultRole: TreeRole = "admin",
): boolean {
  if (!canMutate(tree, nodeId, permissions, defaultRole)) return false
  const destId = newParentId ?? tree.id
  const dest = findNode(tree, destId)
  if (!dest) return false
  // Moving into the tree root only needs rights on the node itself.
  if (dest.id === tree.id) return true
  return canMutate(tree, dest.id, permissions, defaultRole)
}

/** Assign/replace the role for a node. Returns the updated map (new object). */
export function setRole(permissions: PermissionMap, nodeId: string, role: TreeRole): PermissionMap {
  return { ...permissions, [nodeId]: role }
}

export function clearRole(permissions: PermissionMap, nodeId: string): PermissionMap {
  if (!(nodeId in permissions)) return permissions
  const next = { ...permissions }
  delete next[nodeId]
  return next
}
