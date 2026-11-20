import { afterEach, describe, expect, it, vi } from "vitest"

import { IndexedDbUploadStore, type PersistedUpload } from "./persistence"

/**
 * Minimal in-memory IndexedDB fake — just enough surface for
 * IndexedDbUploadStore in src/lib/uploads/persistence.ts
 * (open/onupgradeneeded, transaction → objectStore getAll/put/delete/clear,
 * tx.oncomplete/onerror). Requests resolve on microtasks, matching the real
 * async callback style. No fake-indexeddb dependency is added.
 */

type Row = Record<string, unknown>
type RowMap = Map<unknown, Row>

class FakeIDBRequest<T = unknown> {
  result: T | undefined = undefined
  error: unknown = null
  onsuccess: (() => void) | null = null
  onerror: (() => void) | null = null
  onupgradeneeded: (() => void) | null = null

  succeed(value: T) {
    this.result = value
    this.onsuccess?.()
  }

  fail(error: unknown) {
    this.error = error
    this.onerror?.()
  }
}

function later(fn: () => void) {
  queueMicrotask(fn)
}

interface FakeTx {
  error: unknown
  oncomplete: (() => void) | null
  onerror: (() => void) | null
  onabort: (() => void) | null
  failOps: Set<string>
  _pending: number
  _fail(error: unknown): void
  objectStore(name: string): FakeStore
}

function createStore(rows: RowMap, tx: FakeTx) {
  const request = <T>(op: string, produce: () => T) => {
    const req = new FakeIDBRequest<T>()
    tx._pending += 1
    later(() => {
      try {
        if (tx.failOps.has(op)) throw new Error(`injected ${op} failure`)
        req.succeed(produce())
      } catch (error) {
        req.fail(error)
        tx._fail(error)
      } finally {
        tx._pending -= 1
        if (tx._pending === 0) tx.oncomplete?.()
      }
    })
    return req
  }
  return {
    getAll: () => request("getAll", () => [...rows.values()]),
    put: (row: Row) =>
      request("put", () => {
        rows.set(row.id, row)
        return row.id
      }),
    delete: (key: unknown) =>
      request("delete", () => {
        rows.delete(key)
      }),
    clear: () =>
      request("clear", () => {
        rows.clear()
      }),
  }
}

type FakeStore = ReturnType<typeof createStore>

class FakeIDBDatabase {
  readonly name: string
  readonly objectStoreNames: { contains(name: string): boolean }
  /** Operation names ("getAll" | "put" | "delete" | "clear") that should fail. */
  failOps = new Set<string>()
  private readonly stores = new Map<string, RowMap>()

  constructor(name: string) {
    this.name = name
    this.objectStoreNames = { contains: (n) => this.stores.has(n) }
  }

  createObjectStore(name: string, _options?: { keyPath?: string }): FakeStore {
    const rows: RowMap = new Map()
    this.stores.set(name, rows)
    // The returned store is unused by openDb; the real one comes from transaction().
    return createStore(rows, this.makeTx(rows))
  }

  storeRows(name: string): RowMap {
    const rows = this.stores.get(name)
    if (!rows) throw new Error(`unknown object store: ${name}`)
    return rows
  }

  private makeTx(rows: RowMap): FakeTx {
    const tx: FakeTx = {
      error: null,
      oncomplete: null,
      onerror: null,
      onabort: null,
      failOps: this.failOps,
      _pending: 0,
      _fail(error: unknown) {
        tx.error = error
        tx.onerror?.()
        tx.onabort?.()
      },
      objectStore: () => createStore(rows, tx),
    }
    return tx
  }

  transaction(storeName: string) {
    return this.makeTx(this.storeRows(storeName))
  }

  close() {}
}

interface FakeIndexedDB {
  open: (name: string, version?: number) => FakeIDBRequest<FakeIDBDatabase>
  failOpen: boolean
}

function makeIndexedDB(): { fake: FakeIndexedDB; databases: Map<string, FakeIDBDatabase> } {
  const databases = new Map<string, FakeIDBDatabase>()
  const fake: FakeIndexedDB = {
    failOpen: false,
    open: (name: string) => {
      const request = new FakeIDBRequest<FakeIDBDatabase>()
      queueMicrotask(() => {
        if (fake.failOpen) {
          request.fail(new Error("injected open failure"))
          return
        }
        let db = databases.get(name)
        const upgrading = db === undefined
        if (!db) {
          db = new FakeIDBDatabase(name)
          databases.set(name, db)
        }
        // onupgradeneeded must observe request.result, like the real API.
        request.result = db
        if (upgrading) request.onupgradeneeded?.()
        request.onsuccess?.()
      })
      return request
    },
  }
  return { fake, databases }
}

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

function dbRows(databases: Map<string, FakeIDBDatabase>): RowMap {
  const db = databases.get("spindle-uploads")
  if (!db) throw new Error("uploads database was never opened")
  return db.storeRows("entries")
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("IndexedDbUploadStore", () => {
  it("saves, loads, updates, removes and clears entries", async () => {
    const { fake, databases } = makeIndexedDB()
    vi.stubGlobal("indexedDB", fake)
    const store = new IndexedDbUploadStore()
    const entry = makeEntry("u1")

    await store.save(entry)
    expect(await store.load()).toEqual([entry])

    // Saving the same id replaces rather than duplicates (keyPath: "id").
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
    expect(dbRows(databases).size).toBe(0)
  })

  it("persists uploadedParts as a deep copy, not a shared reference", async () => {
    const { fake } = makeIndexedDB()
    vi.stubGlobal("indexedDB", fake)
    const store = new IndexedDbUploadStore()
    const entry = makeEntry("u1")

    await store.save(entry)
    entry.uploadedParts.push({ partNumber: 2, etag: "etag-2" })
    entry.uploadedParts[0].etag = "mutated"

    const loaded = await store.load()
    expect(loaded[0].uploadedParts).toEqual([{ partNumber: 1, etag: "etag-1" }])
  })

  it("returns [] when the store is empty", async () => {
    const { fake } = makeIndexedDB()
    vi.stubGlobal("indexedDB", fake)
    const store = new IndexedDbUploadStore()
    expect(await store.load()).toEqual([])
  })

  it("rejects when indexedDB is unavailable", async () => {
    vi.stubGlobal("indexedDB", undefined)
    const store = new IndexedDbUploadStore()
    await expect(store.load()).rejects.toThrow("IndexedDB unavailable")
    await expect(store.save(makeEntry("u1"))).rejects.toThrow("IndexedDB unavailable")
    await expect(store.remove("u1")).rejects.toThrow("IndexedDB unavailable")
    await expect(store.clear()).rejects.toThrow("IndexedDB unavailable")
  })

  it("rejects every operation when open fails", async () => {
    const { fake } = makeIndexedDB()
    fake.failOpen = true
    vi.stubGlobal("indexedDB", fake)
    const store = new IndexedDbUploadStore()

    await expect(store.load()).rejects.toThrow("injected open failure")
    await expect(store.save(makeEntry("u1"))).rejects.toThrow("injected open failure")
    await expect(store.remove("u1")).rejects.toThrow("injected open failure")
    await expect(store.clear()).rejects.toThrow("injected open failure")
  })

  it("rejects load when getAll fails", async () => {
    const { fake, databases } = makeIndexedDB()
    vi.stubGlobal("indexedDB", fake)
    const store = new IndexedDbUploadStore()
    await store.save(makeEntry("u1"))

    databases.get("spindle-uploads")!.failOps.add("getAll")
    await expect(store.load()).rejects.toThrow("injected getAll failure")
  })

  it("rejects save when put fails", async () => {
    const { fake, databases } = makeIndexedDB()
    vi.stubGlobal("indexedDB", fake)
    const store = new IndexedDbUploadStore()
    await store.save(makeEntry("u1"))

    databases.get("spindle-uploads")!.failOps.add("put")
    await expect(store.save(makeEntry("u2"))).rejects.toThrow("injected put failure")
    // The failed write must not have been committed.
    databases.get("spindle-uploads")!.failOps.delete("put")
    expect((await store.load()).map((e) => e.id)).toEqual(["u1"])
  })

  it("rejects remove and clear when their operations fail", async () => {
    const { fake, databases } = makeIndexedDB()
    vi.stubGlobal("indexedDB", fake)
    const store = new IndexedDbUploadStore()
    await store.save(makeEntry("u1"))

    const db = databases.get("spindle-uploads")!
    db.failOps.add("delete")
    await expect(store.remove("u1")).rejects.toThrow("injected delete failure")

    db.failOps.delete("delete")
    db.failOps.add("clear")
    await expect(store.clear()).rejects.toThrow("injected clear failure")

    db.failOps.delete("clear")
    expect((await store.load()).map((e) => e.id)).toEqual(["u1"])
  })
})
