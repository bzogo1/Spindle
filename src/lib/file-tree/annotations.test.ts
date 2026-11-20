import { describe, expect, it } from "vitest"

import { BookmarkStore, FavoriteStore, RecentFilesStore, createMemoryStorage } from "./annotations"
import { CollectionStore } from "./collections"
import { TagStore } from "./tags"
import { filterExpandedIds, filterVisibleItems, isFilterActive, nodeMatchesFilter } from "./filters"
import { bookmarkFolder, isSmartFolder, recentFolder, withSmartFolders } from "./smart-folders"
import { createNode, findNode, type FileTreeNode } from "./tree"

const file = (id: string, name: string): FileTreeNode => createNode({ id, name, type: "file" })
const dir = (id: string, name: string, children: FileTreeNode[] = []): FileTreeNode =>
  createNode({ id, name, type: "dir", children })

/** root > [docs>[a.md], src>[index.ts], readme.md] */
const sampleTree = (): FileTreeNode =>
  dir("root", "root", [
    dir("docs", "docs", [file("a", "a.md")]),
    dir("src", "src", [file("index", "index.ts")]),
    file("readme", "readme.md"),
  ])

describe("BookmarkStore", () => {
  it("toggles, persists and reloads", () => {
    const storage = createMemoryStorage()
    const store = new BookmarkStore(storage)
    store.add("a")
    expect(store.has("a")).toBe(true)
    expect(store.ids()).toEqual(["a"])
    store.toggle("a")
    expect(store.has("a")).toBe(false)
    store.toggle("a")
    // A fresh store over the same storage sees the bookmark.
    expect(new BookmarkStore(storage).has("a")).toBe(true)
  })

  it("notifies subscribers", () => {
    const store = new BookmarkStore(createMemoryStorage())
    let calls = 0
    const unsub = store.subscribe(() => (calls += 1))
    store.add("x")
    store.remove("x")
    unsub()
    store.add("y")
    expect(calls).toBe(2)
  })
})

describe("RecentFilesStore", () => {
  it("keeps most-recent-first order and caps size", () => {
    const store = new RecentFilesStore(createMemoryStorage(), "k", 3)
    store.recordOpen("a")
    store.recordOpen("b")
    store.recordOpen("a") // re-open moves to front
    store.recordOpen("c")
    store.recordOpen("d") // evicts oldest ("b")
    expect(store.ids()).toEqual(["d", "c", "a"])
  })
})

describe("FavoriteStore", () => {
  it("is independent of bookmarks", () => {
    const storage = createMemoryStorage()
    const favs = new FavoriteStore(storage)
    const bookmarks = new BookmarkStore(storage)
    favs.add("n1")
    expect(favs.has("n1")).toBe(true)
    expect(bookmarks.has("n1")).toBe(false)
  })
})

describe("TagStore", () => {
  it("creates tags with colors and assigns them to nodes", () => {
    const store = new TagStore(createMemoryStorage())
    const tag = store.create("bug", "#f00")
    expect(store.get(tag.id)?.color).toBe("#f00")
    expect(store.assign("a", tag.id)).toBe(true)
    expect(store.assign("a", tag.id)).toBe(false) // idempotent
    expect(store.tagIdsFor("a")).toEqual([tag.id])
    expect(store.tagsFor("a").map((t) => t.name)).toEqual(["bug"])
    expect(store.nodeIdsWithTag(tag.id)).toEqual(["a"])
    store.unassign("a", tag.id)
    expect(store.tagIdsFor("a")).toEqual([])
  })

  it("persists tags and assignments", () => {
    const storage = createMemoryStorage()
    const store = new TagStore(storage)
    const tag = store.create("ui", "#0f0")
    store.assign("n", tag.id)
    const reloaded = new TagStore(storage)
    expect(reloaded.get(tag.id)?.name).toBe("ui")
    expect(reloaded.tagIdsFor("n")).toEqual([tag.id])
  })

  it("removing a tag clears its assignments", () => {
    const store = new TagStore(createMemoryStorage())
    const tag = store.create("x")
    store.assign("n", tag.id)
    store.remove(tag.id)
    expect(store.tagIdsFor("n")).toEqual([])
  })

  it("survives corrupted assignment payloads", () => {
    const storage = createMemoryStorage()
    const tag = { id: "t1", name: "ok", color: "#fff" }
    storage.setItem("spindle:tree-tags", JSON.stringify([tag]))
    // Non-array assignment value + array with non-string entries.
    storage.setItem(
      "spindle:tree-tag-assignments",
      JSON.stringify({ good: "not-an-array", mixed: ["t1", 42, null], bad: { nested: true } }),
    )
    const store = new TagStore(storage)
    expect(store.get("t1")?.name).toBe("ok")
    expect(store.tagIdsFor("good")).toEqual([])
    expect(store.tagIdsFor("mixed")).toEqual(["t1"])
    expect(store.tagIdsFor("bad")).toEqual([])
  })

  it.each(["{}", "null", "5", '"str"', '[{"id":"t","name":"n"}]'])(
    "survives corrupt top-level tag payload %s",
    (raw) => {
      const storage = createMemoryStorage()
      storage.setItem("spindle:tree-tags", raw)
      storage.setItem("spindle:tree-tag-assignments", raw)
      const store = new TagStore(storage) // must not throw
      if (raw === '[{"id":"t","name":"n"}]') {
        expect(store.list()).toHaveLength(1)
      } else {
        expect(store.list()).toEqual([])
      }
    },
  )
})

describe("CollectionStore", () => {
  it("saves and applies named collections", () => {
    const store = new CollectionStore(createMemoryStorage())
    const col = store.create("review", ["a", "readme"], { bookmarkOnly: true })
    expect(store.get(col.id)?.name).toBe("review")
    expect(store.nodeIds(col.id)).toEqual(["a", "readme"])
    expect(store.list().map((c) => c.name)).toEqual(["review"])
    store.update(col.id, { name: "review-2" })
    expect(store.get(col.id)?.name).toBe("review-2")
    store.remove(col.id)
    expect(store.get(col.id)).toBeUndefined()
  })

  it("notifies subscribers on create/update/remove", () => {
    const store = new CollectionStore(createMemoryStorage())
    let calls = 0
    const unsub = store.subscribe(() => (calls += 1))
    const col = store.create("c1", ["a"])
    store.update(col.id, { name: "c2" })
    store.remove(col.id)
    unsub()
    store.create("c3", [])
    expect(calls).toBe(3)
  })

  it.each(["{}", "null", "5", '"str"'])(
    "survives corrupt top-level collection payload %s",
    (raw) => {
      const storage = createMemoryStorage()
      storage.setItem("spindle:tree-collections", raw)
      const store = new CollectionStore(storage) // must not throw
      expect(store.list()).toEqual([])
    },
  )
})

describe("filters", () => {
  const sources = {
    isBookmarked: (id: string) => id === "a",
    isFavorite: (id: string) => id === "readme",
    isRecent: (id: string) => id === "index",
    tagIdsFor: (id: string) => (id === "readme" ? ["t1"] : []),
  }
  const tree = sampleTree()
  const expanded = () => true

  it("isFilterActive detects empty vs set filters", () => {
    expect(isFilterActive(null)).toBe(false)
    expect(isFilterActive({})).toBe(false)
    expect(isFilterActive({ bookmarkOnly: true })).toBe(true)
    expect(isFilterActive({ tagIds: ["t"] })).toBe(true)
  })

  it("nodeMatchesFilter applies every enabled clause", () => {
    expect(nodeMatchesFilter("a", { bookmarkOnly: true }, sources)).toBe(true)
    expect(nodeMatchesFilter("readme", { bookmarkOnly: true }, sources)).toBe(false)
    expect(nodeMatchesFilter("readme", { tagIds: ["t1", "t2"] }, sources)).toBe(true)
    expect(nodeMatchesFilter("a", { tagIds: ["t1"] }, sources)).toBe(false)
  })

  it("filterVisibleItems keeps ancestors of matches", () => {
    const rows = filterVisibleItems(tree, expanded, { bookmarkOnly: true }, sources)
    const ids = rows.map((r) => r.node.id)
    // "a" matches; docs (parent) and root stay visible; others hidden.
    expect(ids).toContain("a")
    expect(ids).toContain("docs")
    expect(ids).toContain("root")
    expect(ids).not.toContain("src")
    expect(ids).not.toContain("index")
    expect(ids).not.toContain("readme")
  })

  it("returns all rows when no filter is active", () => {
    const rows = filterVisibleItems(tree, expanded, {}, sources)
    expect(rows).toHaveLength(6)
  })

  it("filterExpandedIds returns ancestors of matches across the whole tree", () => {
    // Match "a" (inside docs) even when docs is collapsed — ancestors must expand.
    const collapsed = () => false
    // With everything collapsed the match isn't even visible -> empty result.
    expect(filterVisibleItems(tree, collapsed, { bookmarkOnly: true }, sources)).toEqual([])
    const ids = filterExpandedIds(tree, { bookmarkOnly: true }, sources)
    expect(ids.has("docs")).toBe(true)
    expect(ids.has("root")).toBe(true)
    expect(ids.has("src")).toBe(false)
    // With the auto-expanded set applied, the match becomes visible.
    const isExpanded = (id: string) => id === "root" || id === "docs" || ids.has(id)
    const rows = filterVisibleItems(tree, isExpanded, { bookmarkOnly: true }, sources)
    expect(rows.map((r) => r.node.id)).toContain("a")
    // Inactive filter -> empty set.
    expect(filterExpandedIds(tree, {}, sources).size).toBe(0)
  })
})

describe("smart folders", () => {
  it("builds view-only folders referencing real nodes", () => {
    const tree = sampleTree()
    const folder = recentFolder(tree, ["index", "a", "missing"], "Recent")
    expect(isSmartFolder(folder)).toBe(true)
    expect(folder.children.map((c) => c.id)).toEqual(["index", "a"])
    // Children keep their real ids.
    expect(folder.children[0].name).toBe("index.ts")
  })

  it("withSmartFolders prepends folders to the root children", () => {
    const tree = sampleTree()
    const folder = bookmarkFolder(tree, ["readme"])
    const next = withSmartFolders(tree, [folder])
    expect(next.children[0].id).toBe("smart-bookmarks")
    expect(next.children).toHaveLength(4)
    // Original tree untouched.
    expect(tree.children).toHaveLength(3)
    expect(findNode(next, "readme")).not.toBeNull()
  })
})
