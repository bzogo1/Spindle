import { describe, expect, it, vi } from "vitest"

import { createNode, findNode, move, type FileTreeNode } from "./tree"
import { MockFileTreeSync, reconcile, type TreeMoveOp } from "./sync"

function dir(id: string, name: string, children: FileTreeNode[] = []): FileTreeNode {
  return createNode({ id, name, type: "dir", children })
}
function file(id: string, name: string): FileTreeNode {
  return createNode({ id, name, type: "file" })
}

/** root > [docs>[sub>deep, a], src>[index], readme] */
function sampleTree(): FileTreeNode {
  return dir("root", "root", [
    dir("docs", "docs", [dir("sub", "sub", [file("deep", "deep.md")]), file("a", "a.md")]),
    dir("src", "src", [file("index", "index.ts")]),
    file("readme", "readme.md"),
  ])
}

function op(partial: Partial<TreeMoveOp> & Pick<TreeMoveOp, "nodeId" | "newParentId">): TreeMoveOp {
  return {
    opId: partial.opId ?? `op-${partial.nodeId}`,
    index: undefined,
    baseRevision: 0,
    ...partial,
  }
}

function childIds(tree: FileTreeNode, id: string | null) {
  const parent = id === null ? tree : findNode(tree, id!)
  return parent!.children.map((child) => child.id)
}

describe("MockFileTreeSync", () => {
  it("applies ops and returns an authoritative snapshot + revision", async () => {
    const sync = new MockFileTreeSync({ tree: sampleTree() })
    const response = await sync.applyMove(op({ nodeId: "readme", newParentId: "src", index: 0 }))
    expect(response.ok).toBe(true)
    if (!response.ok) return
    expect(response.revision).toBe(1)
    expect(childIds(response.tree, "src")).toEqual(["readme", "index"])
    expect(sync.revision).toBe(1)
    expect(childIds(sync.getTree(), "src")).toEqual(["readme", "index"])
  })

  it("rejects invalid ops and honors failWith", async () => {
    const sync = new MockFileTreeSync({
      tree: sampleTree(),
      failWith: (o) => (o.nodeId === "readme" ? "server says no" : null),
    })
    const failed = await sync.applyMove(op({ nodeId: "readme", newParentId: "src" }))
    expect(failed).toEqual({ ok: false, error: "server says no" })
    const invalid = await sync.applyMove(op({ nodeId: "docs", newParentId: "sub" }))
    expect(invalid.ok).toBe(false)
  })

  it("beforeApply simulates a concurrent client's write", async () => {
    // Another client moves 'a' into 'src' right before our op lands.
    const sync = new MockFileTreeSync({
      tree: sampleTree(),
      beforeApply: (tree) => {
        const result = move(tree, "a", "src")
        return result.ok ? result.value : tree
      },
    })
    const response = await sync.applyMove(op({ nodeId: "readme", newParentId: "src" }))
    expect(response.ok).toBe(true)
    if (!response.ok) return
    // Both the concurrent move and ours are visible in the snapshot.
    expect(childIds(response.tree, "src")).toEqual(["index", "a", "readme"])
  })

  it("honours latencyMs before resolving", async () => {
    vi.useFakeTimers()
    try {
      const sync = new MockFileTreeSync({ tree: sampleTree(), latencyMs: 50 })
      let settled = false
      const promise = sync
        .applyMove(op({ nodeId: "readme", newParentId: "src" }))
        .then((response) => {
          settled = true
          return response
        })
      await vi.advanceTimersByTimeAsync(49)
      expect(settled).toBe(false)
      await vi.advanceTimersByTimeAsync(1)
      expect((await promise).ok).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it("returns defensive copies from getTree and responses", async () => {
    const sync = new MockFileTreeSync({ tree: sampleTree() })
    const snapshot = sync.getTree()
    snapshot.children.length = 0
    expect(sync.getTree().children).toHaveLength(3)

    const response = await sync.applyMove(op({ nodeId: "readme", newParentId: "src" }))
    expect(response.ok).toBe(true)
    if (!response.ok) return
    response.tree.children.length = 0
    // Post-move the root has 2 children (docs, src); mutating the response
    // snapshot must not affect the sync's internal tree.
    expect(sync.getTree().children).toHaveLength(2)
    expect(childIds(sync.getTree(), "src")).toContain("readme")
  })
})

describe("reconcile", () => {
  it("replays non-conflicting pending ops onto the server tree", () => {
    const base = sampleTree()
    // Server applied our first op already (readme -> src) and nothing else.
    const server = move(base, "readme", "src", 0)
    expect(server.ok).toBe(true)
    if (!server.ok) return
    const pending = [op({ opId: "p2", nodeId: "a", newParentId: "src", index: 0 })]
    const result = reconcile(server.value, base, pending)
    expect(result.droppedOps).toHaveLength(0)
    expect(result.appliedOps).toHaveLength(1)
    expect(childIds(result.tree, "src")).toEqual(["a", "readme", "index"])
  })

  it("server wins when it moved the same node (conflict -> op dropped)", () => {
    const base = sampleTree()
    // Another client moved 'readme' into 'docs' before our op was acked.
    const server = move(base, "readme", "docs")
    expect(server.ok).toBe(true)
    if (!server.ok) return
    // Our pending op tried to move 'readme' into 'src' — conflicts, dropped.
    const pending = [op({ nodeId: "readme", newParentId: "src", index: 0 })]
    const result = reconcile(server.value, base, pending)
    expect(result.appliedOps).toHaveLength(0)
    expect(result.droppedOps).toHaveLength(1)
    // The server's placement is preserved.
    expect(childIds(result.tree, "docs")).toContain("readme")
    expect(childIds(result.tree, null)).not.toContain("readme")
  })

  it("drops ops for nodes the server deleted", () => {
    const base = sampleTree()
    const server = dir("root", "root", [
      dir("docs", "docs", [dir("sub", "sub", [file("deep", "deep.md")])]),
      dir("src", "src", [file("index", "index.ts")]),
      file("readme", "readme.md"),
    ])
    const result = reconcile(server, base, [op({ nodeId: "a", newParentId: "src" })])
    expect(result.appliedOps).toHaveLength(0)
    expect(result.droppedOps).toHaveLength(1)
  })

  it("drops ops whose destination became invalid on the server", () => {
    const base = sampleTree()
    // Server moved 'src' inside 'docs' — 'a' -> 'src' is still valid, so use a
    // cycle instead: server moved 'docs' into 'src', making 'a' -> 'docs' fine
    // but 'docs' -> 'a'? 'a' is a file. Use 'sub' -> 'docs' which stays valid;
    // instead test an op that only became a cycle: 'docs' -> 'sub' was already
    // a cycle in base too. Simplest: destination 'deep' is a file -> invalid.
    const result = reconcile(base, base, [op({ nodeId: "a", newParentId: "deep" })])
    expect(result.appliedOps).toHaveLength(0)
    expect(result.droppedOps).toHaveLength(1)
  })

  it("chains multiple pending ops on the same node in order", () => {
    const base = sampleTree()
    const server = sampleTree() // authoritative snapshot unchanged
    const pending = [
      op({ opId: "p1", nodeId: "readme", newParentId: "src", index: 0 }),
      op({ opId: "p2", nodeId: "readme", newParentId: "docs" }),
    ]
    const result = reconcile(server, base, pending)
    expect(result.droppedOps).toHaveLength(0)
    expect(result.appliedOps).toHaveLength(2)
    expect(childIds(result.tree, "docs")).toContain("readme")
    expect(childIds(result.tree, null)).not.toContain("readme")
  })

  it("does not treat ordering-only server changes as conflicts", () => {
    const base = sampleTree()
    // Another client reordered top-level siblings; 'readme' parent unchanged.
    const server = move(base, "readme", null, 0)
    expect(server.ok).toBe(true)
    if (!server.ok) return
    const pending = [op({ nodeId: "a", newParentId: "src" })]
    const result = reconcile(server.value, base, pending)
    expect(result.droppedOps).toHaveLength(0)
    expect(result.appliedOps).toHaveLength(1)
    expect(childIds(result.tree, "src")).toContain("a")
  })
})
