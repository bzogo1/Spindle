import { afterEach, describe, expect, it, vi } from "vitest"

import {
  createDefaultStore,
  IndexedDbUploadStore,
  LocalStorageUploadStore,
  MemoryUploadStore,
  fileKeyFor,
  type PersistedUpload,
} from "./persistence"

const LS_KEY = "spindle:upload-queue:v1"

function makeEntry(id: string, overrides: Partial<PersistedUpload> = {}): PersistedUpload {
  return {
    id,
    fileKey: `file-${id}:10:1`,
    fileName: `${id}.bin`,
    size: 10,
    key: `${id}.bin`,
    partSize: 4,
    uploadedParts: [{ partNumber: 1, etag: "etag-1" }],
    status: "uploading",
    updatedAt: 1_700_000_000_000,
    ...overrides,
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  localStorage.clear()
})

describe("fileKeyFor", () => {
  it("combines name, size and lastModified", () => {
    expect(fileKeyFor({ name: "a.txt", size: 3, lastModified: 42 })).toBe("a.txt:3:42")
    expect(fileKeyFor({ name: "a.txt", size: 3 })).toBe("a.txt:3:0")
  })
})

describe("LocalStorageUploadStore", () => {
  it("saves, loads, updates, removes and clears entries", async () => {
    const store = new LocalStorageUploadStore()
    const entry = makeEntry("u1")

    await store.save(entry)
    expect(await store.load()).toEqual([entry])

    // Saving the same id replaces rather than duplicates.
    await store.save(makeEntry("u1", { status: "paused" }))
    const loaded = await store.load()
    expect(loaded).toHaveLength(1)
    expect(loaded[0].status).toBe("paused")

    await store.save(makeEntry("u2", { status: "error" }))
    expect((await store.load()).map((e) => e.id).sort()).toEqual(["u1", "u2"])

    await store.remove("u1")
    expect((await store.load()).map((e) => e.id)).toEqual(["u2"])

    await store.clear()
    expect(await store.load()).toEqual([])
    expect(localStorage.getItem(LS_KEY)).toBeNull()
  })

  it("returns [] for missing, malformed or non-array payloads", async () => {
    const store = new LocalStorageUploadStore()
    expect(await store.load()).toEqual([])

    localStorage.setItem(LS_KEY, "{not json")
    expect(await store.load()).toEqual([])

    localStorage.setItem(LS_KEY, JSON.stringify({ id: "x" }))
    expect(await store.load()).toEqual([])
  })

  it("trims completed entries when the payload exceeds the size cap", async () => {
    const store = new LocalStorageUploadStore()
    await store.save(makeEntry("active", { status: "uploading" }))

    // A completed entry with a huge fileName pushes the serialized payload
    // over the 512 KiB cap; it must be dropped while active entries survive.
    await store.save(
      makeEntry("done", {
        status: "completed",
        fileName: "x".repeat(600 * 1024),
      }),
    )

    const raw = localStorage.getItem(LS_KEY) ?? ""
    expect(raw.length).toBeLessThanOrEqual(512 * 1024)
    const loaded = await store.load()
    expect(loaded.map((e) => e.id)).toEqual(["active"])
    expect(loaded[0].status).toBe("uploading")
  })

  it("keeps non-completed entries even when still over the cap", async () => {
    const store = new LocalStorageUploadStore()
    await store.save(
      makeEntry("big-active", {
        status: "paused",
        fileName: "y".repeat(600 * 1024),
      }),
    )
    // Trim only removes completed entries; the paused one is retained even
    // though the stored payload still exceeds the cap.
    const loaded = await store.load()
    expect(loaded.map((e) => e.id)).toEqual(["big-active"])
  })

  it("degrades silently when localStorage throws", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied")
    })
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota")
    })
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("denied")
    })

    const store = new LocalStorageUploadStore()
    await expect(store.load()).resolves.toEqual([])
    await expect(store.save(makeEntry("u1"))).resolves.toBeUndefined()
    await expect(store.remove("u1")).resolves.toBeUndefined()
    await expect(store.clear()).resolves.toBeUndefined()
  })
})

describe("createDefaultStore", () => {
  it("prefers IndexedDB when available", () => {
    vi.stubGlobal("indexedDB", {})
    expect(createDefaultStore()).toBeInstanceOf(IndexedDbUploadStore)
  })

  it("falls back to localStorage when IndexedDB is unavailable", () => {
    vi.stubGlobal("indexedDB", undefined)
    expect(createDefaultStore()).toBeInstanceOf(LocalStorageUploadStore)
  })

  it("falls back to memory when neither is available", () => {
    vi.stubGlobal("indexedDB", undefined)
    vi.stubGlobal("localStorage", undefined)
    expect(createDefaultStore()).toBeInstanceOf(MemoryUploadStore)
  })
})
