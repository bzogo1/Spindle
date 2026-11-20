import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import type { FileNode } from "@/lib/api"

import {
  FILE_SHARES_STORAGE_VERSION,
  fileShareHref,
  fileSharesStorageKey,
  readFileShares,
  sanitizeFileShares,
  sharesForNode,
  useFileShares,
} from "./file-share"
import type { FileShare } from "./file-share"

const PROJECT_ID = "prj_01"

function fileNode(overrides: Partial<FileNode> = {}): FileNode {
  return {
    id: "file-tidal",
    name: "tidal-2026.csv",
    kind: "file",
    parentId: null,
    mimeType: "text/csv",
    sizeBytes: 1024,
    owner: "Mara",
    updatedAt: "2026-11-19T08:42:00.000Z",
    ...overrides,
  }
}

const FILES: FileNode[] = [
  fileNode(),
  fileNode({
    id: "folder-data",
    name: "data",
    kind: "folder",
    parentId: null,
    mimeType: "inode/directory",
    sizeBytes: 0,
  }),
  fileNode({
    id: "folder-raw",
    name: "raw",
    kind: "folder",
    parentId: "folder-data",
    mimeType: "inode/directory",
    sizeBytes: 0,
  }),
]

function share(overrides: Partial<FileShare> = {}): FileShare {
  return {
    id: "share_1",
    nodeId: "file-tidal",
    nodeName: "tidal-2026.csv",
    userId: "usr_02",
    userName: "Mara Chen",
    permission: "view",
    createdAt: "2026-11-19T10:00:00.000Z",
    ...overrides,
  }
}

function clearShares() {
  window.localStorage.removeItem(fileSharesStorageKey(PROJECT_ID))
}

beforeEach(clearShares)
afterEach(clearShares)

describe("sanitizeFileShares", () => {
  it("returns an empty list for non-object payloads", () => {
    expect(sanitizeFileShares(null)).toEqual([])
    expect(sanitizeFileShares("garbage")).toEqual([])
    expect(sanitizeFileShares([share()])).toEqual([])
  })

  it("rejects blobs from a different schema version", () => {
    expect(
      sanitizeFileShares({ version: FILE_SHARES_STORAGE_VERSION + 1, shares: [share()] }),
    ).toEqual([])
  })

  it("keeps valid shares and drops malformed records", () => {
    const result = sanitizeFileShares({
      version: FILE_SHARES_STORAGE_VERSION,
      shares: [
        share(),
        { id: "", nodeId: "x" },
        "garbage",
        { ...share({ id: "share_2" }), permission: "bogus" },
      ],
    })
    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({ id: "share_1", permission: "view" })
    // Unknown permissions degrade to the safest level.
    expect(result[1]).toMatchObject({ id: "share_2", permission: "view" })
  })
})

describe("readFileShares", () => {
  it("returns an empty list when nothing is stored", () => {
    expect(readFileShares(PROJECT_ID)).toEqual([])
  })

  it("round-trips a stored blob", () => {
    window.localStorage.setItem(
      fileSharesStorageKey(PROJECT_ID),
      JSON.stringify({ version: FILE_SHARES_STORAGE_VERSION, shares: [share()] }),
    )
    expect(readFileShares(PROJECT_ID)).toEqual([share()])
  })
})

describe("fileShareHref", () => {
  const base = { files: FILES, projectId: PROJECT_ID, pathname: "/projects/prj_01/files" }

  it("links files through the ?preview= deep link and preserves params", () => {
    const href = fileShareHref({ ...base, node: FILES[0], search: "?project=prj_01" })
    expect(href).toBe(
      `${window.location.origin}/projects/prj_01/files?project=prj_01&preview=file-tidal`,
    )
  })

  it("links folders to their canonical path and strips preview", () => {
    const href = fileShareHref({
      ...base,
      node: FILES[2],
      search: "?preview=file-tidal&project=prj_01",
    })
    expect(href).toBe(`${window.location.origin}/projects/prj_01/files/data/raw?project=prj_01`)
  })
})

describe("sharesForNode", () => {
  it("returns only shares for the given node", () => {
    const shares = [
      share(),
      share({ id: "share_2", nodeId: "folder-data" }),
      share({ id: "share_3", nodeId: "file-tidal", userId: "usr_03" }),
    ]
    expect(sharesForNode(shares, "file-tidal").map((s) => s.id)).toEqual(["share_1", "share_3"])
  })
})

describe("useFileShares", () => {
  it("adds, updates permission, and revokes shares", () => {
    const { result } = renderHook(() => useFileShares(PROJECT_ID))

    act(() => {
      result.current.addShare({
        nodeId: "file-tidal",
        nodeName: "tidal-2026.csv",
        userId: "usr_02",
        userName: "Mara Chen",
        permission: "view",
      })
    })
    expect(result.current.shares).toHaveLength(1)
    const added = result.current.shares[0]
    expect(added).toMatchObject({ userId: "usr_02", permission: "view" })

    // Re-adding the same (node, user) pair updates instead of duplicating.
    act(() => {
      result.current.addShare({
        nodeId: "file-tidal",
        nodeName: "tidal-2026.csv",
        userId: "usr_02",
        userName: "Mara Chen",
        permission: "edit",
      })
    })
    expect(result.current.shares).toHaveLength(1)
    expect(result.current.shares[0]?.permission).toBe("edit")

    act(() => result.current.setSharePermission(added.id, "view"))
    expect(result.current.shares[0]?.permission).toBe("view")

    act(() => result.current.revokeShare(added.id))
    expect(result.current.shares).toEqual([])
  })

  it("persists shares to localStorage and restores them on mount", () => {
    const first = renderHook(() => useFileShares(PROJECT_ID))
    act(() => {
      first.result.current.addShare({
        nodeId: "file-tidal",
        nodeName: "tidal-2026.csv",
        userId: "usr_02",
        userName: "Mara Chen",
        permission: "edit",
      })
    })
    first.unmount()

    const stored = JSON.parse(
      window.localStorage.getItem(fileSharesStorageKey(PROJECT_ID)) ?? "{}",
    ) as { shares?: FileShare[] }
    expect(stored.shares).toHaveLength(1)

    const second = renderHook(() => useFileShares(PROJECT_ID))
    expect(second.result.current.shares).toHaveLength(1)
    expect(second.result.current.shares[0]).toMatchObject({
      userId: "usr_02",
      permission: "edit",
    })
  })
})
