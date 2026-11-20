/**
 * Adapters between the app's flat `FileNode[]` workspace model and the nested
 * `FileTreeNode` model used by the drag-and-drop tree.
 *
 * `FileNode` has no explicit order field, so sibling order is derived from
 * the existing `childNodes` convention (name sort). Each `FileTreeNode`
 * keeps the original `FileNode` in `data` so round-tripping is lossless.
 */

import type { FileNode } from "@/lib/api/types"
import { childNodes } from "@/lib/api/workspace-utils"

import { createNode, type FileTreeNode } from "./tree"

const ROOT_ID = "__root__"

/**
 * Build a `FileTreeNode` forest from a flat `FileNode[]` list.
 * Returns a synthetic root dir whose children are the top-level nodes.
 */
export function fileNodesToTree(nodes: FileNode[]): FileTreeNode {
  const build = (parentId: string | null): FileTreeNode[] =>
    childNodes(nodes, parentId).map((node, index) =>
      createNode({
        id: node.id,
        name: node.name,
        type: node.kind === "folder" ? "dir" : "file",
        order: index,
        data: node,
        children: node.kind === "folder" ? build(node.id) : [],
      }),
    )

  return createNode({
    id: ROOT_ID,
    name: "Project root",
    type: "dir",
    order: 0,
    children: build(null),
  })
}

/**
 * Flatten a `FileTreeNode` tree back into a flat `FileNode[]` (pre-order).
 * Nodes without a `FileNode` payload in `data` are skipped.
 */
export function treeToFileNodes(tree: FileTreeNode): FileNode[] {
  const out: FileNode[] = []
  const walk = (node: FileTreeNode, parentId: string | null) => {
    if (node.id !== tree.id && node.data && typeof node.data === "object") {
      const fileNode = node.data as FileNode
      out.push({ ...fileNode, parentId })
    }
    const nextParent = node.id === tree.id ? null : node.id
    for (const child of node.children) walk(child, nextParent)
  }
  walk(tree, null)
  return out
}
