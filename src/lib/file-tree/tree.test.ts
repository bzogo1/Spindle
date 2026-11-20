import { describe, expect, it } from "vitest"

import {
  ancestorIds,
  applyMoves,
  cloneTree,
  collectDirIds,
  createNode,
  findNode,
  findParent,
  getNodePath,
  isDescendantOf,
  move,
  nodePath,
  reorder,
  resolveDrop,
  siblingPosition,
  visibleItems,
  type FileTreeNode,
} from "./tree"

function dir(id: string, name: string, children: FileTreeNode[] = []): FileTreeNode {
  return createNode({ id, name, type: "dir", children })
}

function file(id: string, name: string): FileTreeNode {
  return createNode({ id, name, type: "file" })
}

/**
 * root
 * ├── docs (dir)
 * │   ├── sub (dir)
 * │   │   └── deep.md
 * │   └── a.md
 * ├── src (dir)
 * │   └── index.ts
 * └── readme.md
 */
function sampleTree(): FileTreeNode {
  return dir("root", "root", [
    dir("docs", "docs", [dir("sub", "sub", [file("deep", "deep.md")]), file("a", "a.md")]),
    dir("src", "src", [file("index", "index.ts")]),
    file("readme", "readme.md"),
  ])
}

function childIds(tree: FileTreeNode, id: string | null) {
  const parent = id === null ? tree : findNode(tree, id!)
  return parent!.children.map((child) => child.id)
}

describe("move", () => {
  it("moves a file into another directory at a given index", () => {
    const tree = sampleTree()
    const result = move(tree, "readme", "src", 0)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(childIds(result.value, "src")).toEqual(["readme", "index"])
    expect(childIds(result.value, null)).toEqual(["docs", "src"])
  })

  it("moves a directory with its whole subtree", () => {
    const tree = sampleTree()
    const result = move(tree, "docs", null, 0)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(childIds(result.value, null)).toEqual(["docs", "src", "readme"])
    expect(findNode(result.value, "deep")?.name).toBe("deep.md")
  })

  it("reorders within the same parent", () => {
    const tree = sampleTree()
    // docs children: [sub, a] -> move a before sub => [a, sub]
    const result = move(tree, "a", "docs", 0)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(childIds(result.value, "docs")).toEqual(["a", "sub"])
  })

  it("appends when index is omitted and clamps out-of-range indexes", () => {
    const tree = sampleTree()
    const appended = move(tree, "readme", "src")
    expect(appended.ok && childIds(appended.value, "src")).toEqual(["index", "readme"])
    const clamped = move(tree, "a", "src", 99)
    expect(clamped.ok && childIds(clamped.value, "src")).toEqual(["index", "a"])
  })

  it("treats the root id as the top level like null", () => {
    const tree = sampleTree()
    const result = move(tree, "readme", "root", 0)
    expect(result.ok && childIds(result.value, null)[0]).toBe("readme")
  })

  it("does not mutate the input tree", () => {
    const tree = sampleTree()
    const before = JSON.stringify(tree)
    move(tree, "readme", "src", 0)
    expect(JSON.stringify(tree)).toBe(before)
  })

  it("rejects moving the root", () => {
    expect(move(sampleTree(), "root", "src").ok).toBe(false)
  })

  it("rejects dropping a dir into itself or a descendant (cycle prevention)", () => {
    const tree = sampleTree()
    expect(move(tree, "docs", "docs").ok).toBe(false)
    expect(move(tree, "docs", "sub").ok).toBe(false)
    expect(move(tree, "sub", "docs").ok).toBe(true) // sibling-level move is fine
  })

  it("rejects missing nodes and non-dir destinations", () => {
    const tree = sampleTree()
    expect(move(tree, "nope", "src").ok).toBe(false)
    expect(move(tree, "readme", "a").ok).toBe(false) // 'a' is a file
    expect(move(tree, "readme", "missing").ok).toBe(false)
  })
})

describe("reorder", () => {
  it("moves a node up and down within its parent", () => {
    const tree = sampleTree()
    // docs children [sub, a]; move 'a' (index 1) to index 0
    const up = reorder(tree, "a", 0)
    expect(up.ok && childIds(up.value, "docs")).toEqual(["a", "sub"])
    // move 'sub' (index 0) to index 1
    const down = reorder(tree, "sub", 1)
    expect(down.ok && childIds(down.value, "docs")).toEqual(["a", "sub"])
  })
})

describe("queries", () => {
  it("computes nodePath and ancestor ids", () => {
    const tree = sampleTree()
    expect(nodePath(tree, "deep")).toEqual(["root", "docs", "sub", "deep.md"])
    expect(isDescendantOf(tree, "docs", "deep")).toBe(true)
    expect(isDescendantOf(tree, "docs", "docs")).toBe(false)
    expect(isDescendantOf(tree, "src", "deep")).toBe(false)
  })

  it("reports sibling positions with null for top level", () => {
    const tree = sampleTree()
    expect(siblingPosition(tree, "src")).toEqual({ parentId: null, index: 1 })
    expect(siblingPosition(tree, "a")).toEqual({ parentId: "docs", index: 1 })
    expect(siblingPosition(tree, "root")).toBeNull()
  })
})

describe("resolveDrop", () => {
  it("resolves inside/before/after into post-removal move inputs", () => {
    const tree = sampleTree()
    expect(resolveDrop(tree, "readme", "src", "inside")).toEqual({
      nodeId: "readme",
      newParentId: "src",
      index: undefined,
    })
    // 'a' is docs[1]; dropping readme before it keeps parent docs? no —
    // 'a' lives in docs, so before/after targets docs.
    expect(resolveDrop(tree, "readme", "a", "before")).toEqual({
      nodeId: "readme",
      newParentId: "docs",
      index: 1,
    })
    expect(resolveDrop(tree, "readme", "a", "after")).toEqual({
      nodeId: "readme",
      newParentId: "docs",
      index: 2,
    })
  })

  it("adjusts indexes when dragging within the same parent", () => {
    const tree = sampleTree()
    // move 'sub' (docs[0]) after 'a' (docs[1]) -> docs [a, sub]
    const input = resolveDrop(tree, "sub", "a", "after")
    expect(input).toEqual({ nodeId: "sub", newParentId: "docs", index: 1 })
    const result = input && move(tree, input.nodeId, input.newParentId, input.index)
    expect(result?.ok && childIds(result.value, "docs")).toEqual(["a", "sub"])
  })

  it("rejects invalid drops: self, files, descendants", () => {
    const tree = sampleTree()
    expect(resolveDrop(tree, "docs", "docs", "inside")).toBeNull()
    expect(resolveDrop(tree, "docs", "sub", "inside")).toBeNull() // descendant
    expect(resolveDrop(tree, "readme", "a", "inside")).toBeNull() // file
    expect(resolveDrop(tree, "docs", "deep", "after")).toBeNull() // parent inside drag
    expect(resolveDrop(tree, "x", "src", "inside")).toBeNull()
  })
})

describe("applyMoves", () => {
  it("applies valid moves and skips invalid ones", () => {
    const tree = sampleTree()
    const {
      tree: next,
      applied,
      skipped,
    } = applyMoves(tree, [
      { nodeId: "readme", newParentId: "src", index: 0 },
      { nodeId: "docs", newParentId: "sub" }, // cycle -> skipped
      { nodeId: "a", newParentId: null }, // valid
    ])
    expect(applied).toHaveLength(2)
    expect(skipped).toHaveLength(1)
    expect(childIds(next, "src")).toEqual(["readme", "index"])
    expect(childIds(next, null)).toEqual(["docs", "src", "a"])
  })
})

describe("visibleItems", () => {
  it("flattens only expanded branches in display order", () => {
    const tree = sampleTree()
    const all = visibleItems(tree, () => true).map((row) => row.node.id)
    expect(all).toEqual(["root", "docs", "sub", "deep", "a", "src", "index", "readme"])
    const collapsed = visibleItems(tree, () => false).map((row) => row.node.id)
    expect(collapsed).toEqual(["root", "docs", "src", "readme"])
  })

  it("sorts siblings by the order field, not array position", () => {
    const tree = dir("root", "root", [file("second", "second"), file("first", "first")])
    tree.children[0].order = 1
    tree.children[1].order = 0
    expect(visibleItems(tree, () => true).map((row) => row.node.id)).toEqual([
      "root",
      "first",
      "second",
    ])
  })
})

describe("tree queries and cloning", () => {
  it("cloneTree deep-copies nodes, children and data payloads", () => {
    const tree = sampleTree()
    const payload = { tags: ["a"] }
    findNode(tree, "a")!.data = payload

    const copy = cloneTree(tree)
    expect(copy).toEqual(tree)
    expect(copy).not.toBe(tree)
    expect(copy.children[0]).not.toBe(tree.children[0])
    expect(findNode(copy, "a")!.data).toEqual(payload)
    expect(findNode(copy, "a")!.data).not.toBe(payload)
  })

  it("findNode / getNodePath / findParent / ancestorIds traverse the tree", () => {
    const tree = sampleTree()
    expect(findNode(tree, "deep")?.name).toBe("deep.md")
    expect(findNode(tree, "missing")).toBeNull()
    expect(getNodePath(tree, "deep")?.map((n) => n.id)).toEqual(["root", "docs", "sub", "deep"])
    expect(getNodePath(tree, "missing")).toBeNull()
    expect(findParent(tree, "a")?.id).toBe("docs")
    expect(findParent(tree, "root")).toBeNull()
    expect(ancestorIds(tree, "deep")).toEqual(["root", "docs", "sub"])
    expect(ancestorIds(tree, "missing")).toEqual([])
  })

  it("collectDirIds returns every directory including the root", () => {
    expect(collectDirIds(sampleTree()).sort()).toEqual(["docs", "root", "src", "sub"])
  })

  it("clamps negative move indexes to the start", () => {
    const result = move(sampleTree(), "readme", "src", -3)
    expect(result.ok && childIds(result.value, "src")).toEqual(["readme", "index"])
  })
})
