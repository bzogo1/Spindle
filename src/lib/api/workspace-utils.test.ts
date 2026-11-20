import { describe, expect, it } from "vitest"

import {
  agentRequestsRemaining,
  childNodes,
  fileExtension,
  fileNodePath,
  fileTypeLabel,
  findFolderByPath,
  formatBytes,
  projectDisplayName,
  workspaceStorageUsage,
} from "./workspace-utils"
import type { FileNode } from "./types"

function node(partial: Partial<FileNode> & Pick<FileNode, "id" | "name">): FileNode {
  return {
    kind: "file",
    parentId: null,
    mimeType: "",
    sizeBytes: 0,
    owner: "usr_01",
    updatedAt: "2025-01-01T00:00:00.000Z",
    ...partial,
  }
}

describe("projectDisplayName", () => {
  it("maps known project ids", () => {
    expect(projectDisplayName("coastal-resilience")).toBe("Coastal resilience")
  })

  it("title-cases slug-like ids", () => {
    expect(projectDisplayName("my_cool_project")).toBe("My Cool Project")
  })
})

describe("formatBytes", () => {
  it("formats zero and small values", () => {
    expect(formatBytes(0)).toBe("0 B")
    expect(formatBytes(512)).toBe("512 B")
  })

  it("formats larger units", () => {
    expect(formatBytes(1024)).toBe("1.0 KB")
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB")
    expect(formatBytes(2 * 1024 ** 3)).toBe("2.0 GB")
  })
})

describe("file helpers", () => {
  it("extracts extensions and type labels", () => {
    expect(fileExtension("data.csv")).toBe("CSV")
    expect(fileExtension("noext")).toBe("FILE")
    expect(fileTypeLabel(node({ id: "f1", name: "a.ipynb" }))).toBe("Notebook")
    expect(fileTypeLabel(node({ id: "f2", name: "b.pdf" }))).toBe("PDF")
    expect(
      fileTypeLabel(node({ id: "f3", name: "c.bin", mimeType: "application/octet-stream" })),
    ).toBe("OCTET-STREAM")
    expect(fileTypeLabel(node({ id: "f4", name: "d.unknown" }))).toBe("UNKNOWN")
    expect(fileTypeLabel(node({ id: "f5", name: "dir", kind: "folder", mimeType: "x/y" }))).toBe(
      "Folder",
    )
  })
})

describe("agentRequestsRemaining", () => {
  it("never goes below zero", () => {
    expect(agentRequestsRemaining({ dailyLimit: 20, bonus: 50, used: 10 })).toBe(60)
    expect(agentRequestsRemaining({ dailyLimit: 20, bonus: 0, used: 99 })).toBe(0)
  })
})

const files: FileNode[] = [
  node({ id: "root-file", name: "README.md", parentId: null, sizeBytes: 100 }),
  node({ id: "dir-1", name: "data", kind: "folder", parentId: null }),
  node({ id: "f-csv", name: "survey.csv", parentId: "dir-1", sizeBytes: 200 }),
  node({ id: "f-img", name: "plot.png", parentId: "dir-1", sizeBytes: 300 }),
]

describe("childNodes / findFolderByPath / fileNodePath", () => {
  it("returns direct children sorted by name", () => {
    // localeCompare is case-insensitive: "data" sorts before "README.md".
    expect(childNodes(files, null).map((f) => f.name)).toEqual(["data", "README.md"])
    expect(childNodes(files, "dir-1").map((f) => f.name)).toEqual(["plot.png", "survey.csv"])
  })

  it("resolves folders by path and falls back to a synthetic root", () => {
    expect(findFolderByPath(files, [])?.id).toBe("root")
    expect(findFolderByPath(files, ["data"])?.id).toBe("dir-1")
    expect(findFolderByPath(files, ["missing"])).toBeNull()
    expect(findFolderByPath(files, ["data", "survey.csv"])).toBeNull()
  })

  it("builds the full path for a node", () => {
    const target = files.find((f) => f.id === "f-csv")!
    expect(fileNodePath(files, target)).toEqual(["data", "survey.csv"])
  })
})

describe("workspaceStorageUsage", () => {
  it("sums file sizes only", () => {
    expect(workspaceStorageUsage(files, 1024)).toEqual({ usedBytes: 600, limitBytes: 1024 })
  })
})
