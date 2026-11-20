import { act, renderHook, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import {
  createNode,
  findNode,
  findParent,
  move as treeMove,
  type FileTreeNode,
} from "@/lib/file-tree/tree"
import { MockFileTreeSync } from "@/lib/file-tree/sync"

import { useFileTree } from "./use-file-tree"

const file = (id: string, name: string, order = 0): FileTreeNode =>
  createNode({ id, name, type: "file", order })

const dir = (id: string, name: string, children: FileTreeNode[] = [], order = 0): FileTreeNode =>
  createNode({ id, name, type: "dir", order, children })

/**
 * root
 * ├─ dirA: [x, y]
 * └─ dirB: [z]
 */
const makeTree = (): FileTreeNode =>
  dir("root", "root", [
    dir("dirA", "dirA", [file("x", "x.txt", 0), file("y", "y.txt", 1)], 0),
    dir("dirB", "dirB", [file("z", "z.txt", 0)], 1),
  ])

describe("useFileTree (local mode)", () => {
  it("applies moves optimistically without a sync client", () => {
    const { result } = renderHook(() => useFileTree({ initialTree: makeTree() }))

    let moveResult!: ReturnType<typeof result.current.moveNode>
    act(() => {
      moveResult = result.current.moveNode("x", "dirB")
    })

    expect(moveResult).toEqual({ ok: true })
    // Displayed tree reflects the move even though nothing was persisted.
    expect(findParent(result.current.tree, "x")?.id).toBe("dirB")
    expect(result.current.pendingCount).toBe(1)
    expect(result.current.isSyncing).toBe(true)
  })

  it("rejects invalid moves synchronously", () => {
    const { result } = renderHook(() => useFileTree({ initialTree: makeTree() }))

    expect(result.current.moveNode("missing", "dirB")).toMatchObject({ ok: false })
    expect(result.current.moveNode("x", "x")).toMatchObject({ ok: false })
    expect(result.current.moveNode("root", "dirB")).toMatchObject({ ok: false })
    expect(result.current.pendingCount).toBe(0)
  })

  it("validates against the displayed tree including pending ops", () => {
    const { result } = renderHook(() => useFileTree({ initialTree: makeTree() }))

    act(() => {
      result.current.moveNode("x", "dirB")
    })
    // Moving dirB inside x would now be a cycle only if x were a dir —
    // instead verify a second pending op validates against updated state:
    // y can still move to dirB.
    let second!: ReturnType<typeof result.current.moveNode>
    act(() => {
      second = result.current.moveNode("y", "dirB")
    })
    expect(second.ok).toBe(true)
    expect(result.current.pendingCount).toBe(2)
    expect(findParent(result.current.tree, "y")?.id).toBe("dirB")
  })
})

describe("useFileTree (with sync)", () => {
  it("drains the queue and adopts the authoritative tree", async () => {
    const sync = new MockFileTreeSync({ tree: makeTree() })
    const { result } = renderHook(() => useFileTree({ initialTree: makeTree(), sync }))

    act(() => {
      result.current.moveNode("x", "dirB")
    })
    expect(result.current.pendingCount).toBe(1)

    await waitFor(() => expect(result.current.pendingCount).toBe(0))
    expect(result.current.isSyncing).toBe(false)
    expect(result.current.lastError).toBeNull()
    expect(findParent(result.current.tree, "x")?.id).toBe("dirB")
    // The mock's snapshot agrees.
    expect(findParent(sync.getTree(), "x")?.id).toBe("dirB")
  })

  it("surfaces sync failures, drops the op and reverts the optimistic move", async () => {
    const onSyncError = vi.fn()
    const sync = new MockFileTreeSync({
      tree: makeTree(),
      failWith: () => "server exploded",
    })
    const { result } = renderHook(() => useFileTree({ initialTree: makeTree(), sync, onSyncError }))

    act(() => {
      result.current.moveNode("x", "dirB")
    })

    await waitFor(() => expect(result.current.lastError).toBe("server exploded"))
    expect(onSyncError).toHaveBeenCalledWith(
      "server exploded",
      expect.objectContaining({ nodeId: "x" }),
    )
    expect(result.current.pendingCount).toBe(0)
    // Optimistic effect reverted: x is back in dirA on the displayed tree.
    expect(findParent(result.current.tree, "x")?.id).toBe("dirA")
  })

  it("drops conflicting pending ops when the server wins", async () => {
    const onOpsDropped = vi.fn()
    // Simulate another client moving "y" to the top level right before
    // our first op lands; our second queued op (y -> dirB) then conflicts
    // because the server placed y somewhere else.
    const sync = new MockFileTreeSync({
      tree: makeTree(),
      beforeApply: (tree) => {
        const result = treeMove(tree, "y", null)
        return result.ok ? result.value : tree
      },
    })
    const { result } = renderHook(() =>
      useFileTree({ initialTree: makeTree(), sync, onOpsDropped }),
    )

    act(() => {
      result.current.moveNode("x", "dirB")
      result.current.moveNode("y", "dirB")
    })

    await waitFor(() => expect(result.current.pendingCount).toBe(0))
    expect(onOpsDropped).toHaveBeenCalledTimes(1)
    expect(onOpsDropped.mock.calls[0][0]).toHaveLength(1)
    // Non-conflicting op survived; the conflicting one was dropped.
    expect(findParent(result.current.tree, "x")?.id).toBe("dirB")
    expect(findParent(result.current.tree, "y")?.id).toBe("root")
    expect(result.current.lastError).toBeNull()
  })

  it("reset replaces the tree and clears pending ops", async () => {
    const sync = new MockFileTreeSync({ tree: makeTree(), latencyMs: 20 })
    const { result } = renderHook(() => useFileTree({ initialTree: makeTree(), sync }))

    act(() => {
      result.current.moveNode("x", "dirB")
    })
    expect(result.current.pendingCount).toBe(1)

    const fresh = dir("fresh", "fresh", [file("only", "only.txt")])
    act(() => {
      result.current.reset(fresh)
    })
    expect(result.current.pendingCount).toBe(0)
    expect(result.current.tree.id).toBe("fresh")
    expect(findNode(result.current.tree, "x")).toBeNull()
  })

  it("adopts a new initialTree when nothing is pending", () => {
    const first = makeTree()
    const second = dir("second-root", "second", [file("n", "n.txt")])
    const { result, rerender } = renderHook(({ initialTree }) => useFileTree({ initialTree }), {
      initialProps: { initialTree: first },
    })
    expect(result.current.tree.id).toBe("root")

    rerender({ initialTree: second })
    expect(result.current.tree.id).toBe("second-root")
    expect(findNode(result.current.tree, "n")?.name).toBe("n.txt")
  })
})
