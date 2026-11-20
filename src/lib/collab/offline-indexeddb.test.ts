import { afterEach, describe, expect, it, vi } from "vitest"
import { indexedDBStorage } from "./offline"
import type { CrdtOp } from "./crdt"

/**
 * Minimal in-memory IndexedDB fake — just enough surface for
 * `indexedDBStorage` in ./offline.ts:
 * open/onupgradeneeded → createObjectStore, transaction → objectStore
 * get/put(value,key)/delete, tx.oncomplete → db.close(). Requests resolve on
 * microtasks like the real async callback style. No fake-indexeddb dep.
 *
 * Unlike the uploads fake, this store uses out-of-line keys: `put(value, key)`
 * takes the key as the second argument because createObjectStore is called
 * without a keyPath.
 */

type Row = unknown

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
  failOps: Set<string>
  _pending: number
  _fail(error: unknown): void
  objectStore(name: string): FakeStore
}

function createStore(rows: Map<unknown, Row>, tx: FakeTx) {
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
    get: (key: unknown) => request("get", () => rows.get(key)),
    put: (value: Row, key: unknown) =>
      request("put", () => {
        rows.set(key, value)
        return key
      }),
    delete: (key: unknown) =>
      request("delete", () => {
        rows.delete(key)
      }),
  }
}

type FakeStore = ReturnType<typeof createStore>

class FakeIDBDatabase {
  readonly name: string
  private readonly stores = new Map<string, Map<unknown, Row>>()
  /** Operation names ("get" | "put" | "delete") that should fail. */
  failOps = new Set<string>()

  constructor(name: string) {
    this.name = name
  }

  createObjectStore(name: string): FakeStore {
    const rows = new Map<unknown, Row>()
    this.stores.set(name, rows)
    return createStore(rows, this.makeTx(rows))
  }

  storeRows(name: string): Map<unknown, Row> {
    const rows = this.stores.get(name)
    if (!rows) throw new Error(`unknown object store: ${name}`)
    return rows
  }

  private makeTx(rows: Map<unknown, Row>): FakeTx {
    const tx: FakeTx = {
      error: null,
      oncomplete: null,
      onerror: null,
      failOps: this.failOps,
      _pending: 0,
      _fail(error: unknown) {
        tx.error = error
        tx.onerror?.()
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

const op = (clock: number, text: string): CrdtOp => ({
  type: "insert",
  id: { client: "c1", clock },
  leftOrigin: null,
  text,
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("indexedDBStorage", () => {
  it("saves, loads, replaces and clears ops per key", async () => {
    const { fake, databases } = makeIndexedDB()
    vi.stubGlobal("indexedDB", fake)
    const storage = indexedDBStorage("test-collab", "queue")

    expect(await storage.load("doc-1")).toEqual([])

    await storage.save("doc-1", [op(0, "he"), op(1, "llo")])
    expect(await storage.load("doc-1")).toHaveLength(2)

    // Saving the same key replaces rather than appends.
    await storage.save("doc-1", [op(0, "hi")])
    const loaded = await storage.load("doc-1")
    expect(loaded).toHaveLength(1)
    expect(loaded[0]).toMatchObject({ type: "insert", text: "hi" })

    // Keys are isolated.
    await storage.save("doc-2", [op(0, "other")])
    expect(await storage.load("doc-1")).toHaveLength(1)
    expect(await storage.load("doc-2")).toHaveLength(1)

    await storage.clear("doc-1")
    expect(await storage.load("doc-1")).toEqual([])
    expect(await storage.load("doc-2")).toHaveLength(1)
    expect(databases.get("test-collab")!.storeRows("queue").size).toBe(1)
  })

  it("saving an empty ops array deletes the key", async () => {
    const { fake } = makeIndexedDB()
    vi.stubGlobal("indexedDB", fake)
    const storage = indexedDBStorage("test-collab", "queue")

    await storage.save("doc-1", [op(0, "x")])
    expect(await storage.load("doc-1")).toHaveLength(1)
    await storage.save("doc-1", [])
    expect(await storage.load("doc-1")).toEqual([])
  })

  it("persists across storage instances sharing the same db name", async () => {
    const { fake } = makeIndexedDB()
    vi.stubGlobal("indexedDB", fake)
    const s1 = indexedDBStorage("shared-db", "queue")
    await s1.save("k", [op(0, "persisted")])

    const s2 = indexedDBStorage("shared-db", "queue")
    expect(await s2.load("k")).toHaveLength(1)
  })

  it("rejects all operations when open fails", async () => {
    const { fake } = makeIndexedDB()
    fake.failOpen = true
    vi.stubGlobal("indexedDB", fake)
    const storage = indexedDBStorage("test-collab", "queue")

    await expect(storage.load("k")).rejects.toThrow("injected open failure")
    await expect(storage.save("k", [op(0, "x")])).rejects.toThrow("injected open failure")
    await expect(storage.clear("k")).rejects.toThrow("injected open failure")
  })

  it("rejects load when get fails", async () => {
    const { fake, databases } = makeIndexedDB()
    vi.stubGlobal("indexedDB", fake)
    const storage = indexedDBStorage("test-collab", "queue")
    await storage.save("k", [op(0, "x")])

    databases.get("test-collab")!.failOps.add("get")
    await expect(storage.load("k")).rejects.toThrow("injected get failure")
  })

  it("rejects save when put fails and does not commit", async () => {
    const { fake, databases } = makeIndexedDB()
    vi.stubGlobal("indexedDB", fake)
    const storage = indexedDBStorage("test-collab", "queue")
    await storage.save("k", [op(0, "x")])

    const db = databases.get("test-collab")!
    db.failOps.add("put")
    await expect(storage.save("k", [op(1, "y")])).rejects.toThrow("injected put failure")

    db.failOps.delete("put")
    const loaded = await storage.load("k")
    expect(loaded).toHaveLength(1)
    expect(loaded[0]).toMatchObject({ text: "x" })
  })

  it("closes the db connection when a request fails", async () => {
    const { fake, databases } = makeIndexedDB()
    vi.stubGlobal("indexedDB", fake)
    const storage = indexedDBStorage("test-collab", "queue")
    await storage.save("k", [op(0, "x")])

    const db = databases.get("test-collab")!
    const closeSpy = vi.spyOn(db, "close")
    db.failOps.add("get")
    await expect(storage.load("k")).rejects.toThrow("injected get failure")
    expect(closeSpy).toHaveBeenCalled()
  })

  it("rejects clear when delete fails", async () => {
    const { fake, databases } = makeIndexedDB()
    vi.stubGlobal("indexedDB", fake)
    const storage = indexedDBStorage("test-collab", "queue")
    await storage.save("k", [op(0, "x")])

    databases.get("test-collab")!.failOps.add("delete")
    await expect(storage.clear("k")).rejects.toThrow("injected delete failure")

    databases.get("test-collab")!.failOps.delete("delete")
    expect(await storage.load("k")).toHaveLength(1)
  })
})
