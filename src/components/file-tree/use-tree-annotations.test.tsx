import { act, render, renderHook, screen, fireEvent } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { createNode, decodeSharePayloadFromUrl, findNode, type FileTreeNode } from "@/lib/file-tree"
import { createMemoryStorage } from "@/lib/file-tree/annotations"

import { FileTreeExtrasBar } from "./file-tree-extras"
import { useTreeAnnotations } from "./use-tree-annotations"

describe("useTreeAnnotations", () => {
  it("wires bookmarks/favorites/recents through the hook", () => {
    const storage = createMemoryStorage()
    const { result } = renderHook(() => useTreeAnnotations({ storage }))

    act(() => {
      result.current.toggleBookmark("a")
      result.current.toggleFavorite("b")
      result.current.recordOpen("c")
      result.current.recordOpen("c")
    })

    expect(result.current.isBookmarked("a")).toBe(true)
    expect(result.current.isFavorite("b")).toBe(true)
    expect(result.current.isRecent("c")).toBe(true)
    expect(result.current.recents.ids()).toEqual(["c"])
  })

  it("persists annotations across hook instances", () => {
    const storage = createMemoryStorage()
    const first = renderHook(() => useTreeAnnotations({ storage }))
    act(() => first.result.current.toggleBookmark("persisted"))
    first.unmount()

    const second = renderHook(() => useTreeAnnotations({ storage }))
    expect(second.result.current.isBookmarked("persisted")).toBe(true)
  })

  it("manages tags, filter and permissions", () => {
    const { result } = renderHook(() => useTreeAnnotations({ storage: createMemoryStorage() }))
    let tagId = ""
    act(() => {
      tagId = result.current.tags.create("ui", "#00f").id
      result.current.tags.assign("n1", tagId)
      result.current.setFilter({ tagIds: [tagId] })
      result.current.setNodeRole("n1", "viewer")
    })
    expect(result.current.tagIdsFor("n1")).toEqual([tagId])
    expect(result.current.filter.tagIds).toEqual([tagId])
    expect(result.current.permissions.n1).toBe("viewer")
    act(() => result.current.clearNodeRole("n1"))
    expect(result.current.permissions.n1).toBeUndefined()
  })

  it("builds decodable share payloads with annotations", () => {
    const { result } = renderHook(() => useTreeAnnotations({ storage: createMemoryStorage() }))
    act(() => {
      result.current.toggleBookmark("a")
      result.current.setFilter({ bookmarkOnly: true })
    })
    const url = result.current.buildShareUrl(["a", "b"], ["docs"])
    const payload = decodeSharePayloadFromUrl(url.replace("#share=", ""))
    expect(payload?.nodeIds).toEqual(["a", "b"])
    expect(payload?.expandedIds).toEqual(["docs"])
    expect(payload?.filters?.bookmarkOnly).toBe(true)
    expect(payload?.bookmarks).toEqual(["a"])
  })

  it("saves and applies collections", () => {
    const { result } = renderHook(() => useTreeAnnotations({ storage: createMemoryStorage() }))
    let collectionId = ""
    act(() => {
      collectionId = result.current.saveCollection("review", ["a", "b"]).id
    })
    const applied = result.current.applyCollection(result.current.collections.get(collectionId)!)
    expect(applied.nodeIds).toEqual(["a", "b"])
    act(() => result.current.removeCollection(collectionId))
    expect(result.current.collections.get(collectionId)).toBeUndefined()
  })

  it("collection changes bump the hook version (dropdown stays fresh)", () => {
    const { result } = renderHook(() => useTreeAnnotations({ storage: createMemoryStorage() }))
    const before = result.current.version
    act(() => {
      result.current.collections.create("fresh", ["x"])
    })
    expect(result.current.version).toBeGreaterThan(before)
    expect(result.current.collections.list()).toHaveLength(1)
  })

  it("explicit storage:null does not read or write real localStorage", () => {
    // Seed real localStorage with a permission that must NOT leak in.
    localStorage.setItem("spindle:tree-permissions", JSON.stringify({ leak: "admin" }))
    const { result } = renderHook(() => useTreeAnnotations({ storage: null }))
    expect(result.current.permissions.leak).toBeUndefined()
    act(() => result.current.setNodeRole("n1", "viewer"))
    // Nothing was persisted to real localStorage.
    expect(JSON.parse(localStorage.getItem("spindle:tree-permissions")!)).toEqual({ leak: "admin" })
    localStorage.removeItem("spindle:tree-permissions")
  })

  it("builds smart folders from recents/bookmarks/favorites when enabled", () => {
    const storage = createMemoryStorage()
    const file = (id: string): FileTreeNode => createNode({ id, name: `${id}.txt`, type: "file" })
    const tree: FileTreeNode = createNode({
      id: "root",
      name: "root",
      type: "dir",
      children: [file("a"), file("b"), file("c")],
    })
    const { result } = renderHook(() => useTreeAnnotations({ storage }))
    act(() => {
      result.current.recordOpen("a")
      result.current.toggleBookmark("b")
      result.current.toggleFavorite("c")
    })
    // Disabled -> no folders.
    expect(result.current.smartFolderNodes(tree)).toEqual([])
    act(() => result.current.toggleSmartFolders())
    expect(result.current.smartFoldersEnabled).toBe(true)
    const folders = result.current.smartFolderNodes(tree)
    expect(folders.map((f) => f.id)).toEqual(["smart-recent", "smart-bookmarks", "smart-favorites"])
    // withSmartFolderNodes prepends them to the root.
    const merged = result.current.withSmartFolderNodes(tree)
    expect(merged.children[0].id).toBe("smart-recent")
    expect(findNode(merged, "a")?.name).toBe("a.txt")
  })
})

describe("FileTreeExtrasBar", () => {
  function setup() {
    const storage = createMemoryStorage()
    return renderHook(() => useTreeAnnotations({ storage }))
  }

  it("toggles filter flags via buttons", () => {
    const { result } = setup()
    render(<FileTreeExtrasBar annotations={result.current} />)
    fireEvent.click(screen.getByRole("button", { name: "Bookmarks" }))
    expect(result.current.filter.bookmarkOnly).toBe(true)
    fireEvent.click(screen.getByRole("button", { name: "Clear filter" }))
    expect(result.current.filter).toEqual({})
  })

  it("saves a collection from the current selection and applies it", () => {
    const { result } = setup()
    const onApplyNodeIds = vi.fn()
    render(
      <FileTreeExtrasBar
        annotations={result.current}
        selectedNodeIds={["a", "b"]}
        onApplyNodeIds={onApplyNodeIds}
      />,
    )
    fireEvent.change(screen.getByLabelText("New collection name"), {
      target: { value: "my set" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Save selection" }))
    expect(result.current.collections.list().map((c) => c.name)).toEqual(["my set"])

    fireEvent.change(screen.getByLabelText("Apply collection"), {
      target: { value: result.current.collections.list()[0].id },
    })
    expect(onApplyNodeIds).toHaveBeenCalledWith(["a", "b"])
  })

  it("edits node role when permissionNodeId is provided", () => {
    const { result } = setup()
    render(<FileTreeExtrasBar annotations={result.current} permissionNodeId="n1" />)
    fireEvent.change(screen.getByLabelText("Role for n1"), { target: { value: "viewer" } })
    expect(result.current.permissions.n1).toBe("viewer")
  })

  it("calls onShare with a share URL", () => {
    const { result } = setup()
    const onShare = vi.fn()
    render(
      <FileTreeExtrasBar annotations={result.current} selectedNodeIds={["x"]} onShare={onShare} />,
    )
    fireEvent.click(screen.getByRole("button", { name: "Share" }))
    expect(onShare).toHaveBeenCalledWith(expect.stringContaining("#share="))
  })

  it("toggles smart folders", () => {
    const { result } = setup()
    const { rerender } = render(<FileTreeExtrasBar annotations={result.current} />)
    const button = screen.getByRole("button", { name: "Smart folders" })
    expect(button).toHaveAttribute("aria-pressed", "false")
    fireEvent.click(button)
    expect(result.current.smartFoldersEnabled).toBe(true)
    // The bar receives `annotations` as a prop — rerender with the new object.
    rerender(<FileTreeExtrasBar annotations={result.current} />)
    expect(screen.getByRole("button", { name: "Smart folders" })).toHaveAttribute(
      "aria-pressed",
      "true",
    )
  })
})
