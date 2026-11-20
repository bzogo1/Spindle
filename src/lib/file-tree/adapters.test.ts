import { describe, expect, it } from "vitest"

import type { FileNode } from "@/lib/api/types"

import { fileNodesToTree, treeToFileNodes } from "./adapters"
import { createNode, findNode, move } from "./tree"

function fn(
  id: string,
  name: string,
  parentId: string | null,
  kind: "file" | "folder" = "file",
): FileNode {
  return {
    id,
    name,
    kind,
    parentId,
    mimeType: kind === "folder" ? "inode/directory" : "text/plain",
    sizeBytes: kind === "folder" ? 0 : 100,
    owner: "Ada",
    updatedAt: "2026-01-01T00:00:00.000Z",
  }
}

const nodes: FileNode[] = [
  fn("f1", "b.txt", null),
  fn("f2", "a.txt", null),
  fn("d1", "docs", null, "folder"),
  fn("f3", "inside.md", "d1"),
]

describe("fileNodesToTree / treeToFileNodes", () => {
  it("nests flat FileNodes under a synthetic root, name-sorted", () => {
    const tree = fileNodesToTree(nodes)
    expect(tree.id).toBe("__root__")
    // childNodes sorts by name only: a.txt, b.txt, docs
    expect(tree.children.map((c) => c.id)).toEqual(["f2", "f1", "d1"])
  })

  it("round-trips nodes back to a flat list with correct parentIds", () => {
    const flat = treeToFileNodes(fileNodesToTree(nodes))
    const byId = new Map(flat.map((n) => [n.id, n]))
    expect(byId.get("f3")?.parentId).toBe("d1")
    expect(byId.get("f1")?.parentId).toBeNull()
    expect(flat).toHaveLength(4)
  })

  it("preserves FileNode payloads through tree moves", () => {
    const tree = fileNodesToTree(nodes)
    const moved = move(tree, "f1", "d1")
    expect(moved.ok).toBe(true)
    if (!moved.ok) return
    const target = findNode(moved.value, "d1")
    expect(target?.children.map((c) => c.id).sort()).toEqual(["f1", "f3"])
    const flat = treeToFileNodes(moved.value)
    expect(flat.find((n) => n.id === "f1")?.parentId).toBe("d1")
  })

  it("handles empty input and orphaned children", () => {
    expect(fileNodesToTree([]).children).toEqual([])
    // A node whose parentId points nowhere is unreachable from the root.
    const orphan = fileNodesToTree([fn("o", "orphan.txt", "missing")])
    expect(orphan.children).toEqual([])
    expect(treeToFileNodes(orphan)).toEqual([])
  })

  it("skips tree nodes that have no FileNode payload in data", () => {
    const tree = createNode({
      id: "__root__",
      name: "root",
      type: "dir",
      children: [
        createNode({
          id: "bare",
          name: "bare",
          type: "dir",
          children: [
            createNode({
              id: "kept",
              name: "kept",
              type: "file",
              data: fn("kept", "kept.txt", "bare"),
            }),
          ],
        }),
      ],
    })
    const flat = treeToFileNodes(tree)
    // "bare" itself is skipped but its child is emitted with the tree-derived
    // parentId (the skipped dir's id).
    expect(flat.map((n) => n.id)).toEqual(["kept"])
    expect(flat[0].parentId).toBe("bare")
  })
})
