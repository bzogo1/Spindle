import { readFileSync } from "node:fs"
import { join } from "node:path"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Tests for `replayOutbox` inside public/pwa/sw-core.js — the service
 * worker's Background Sync replay path. Uses the same `new Function`
 * evaluation trick as sw-core.test.ts plus a minimal in-memory IndexedDB
 * fake (no fake-indexeddb dependency).
 */

interface SwCoreOutbox {
  OUTBOX_DB_NAME: string
  OUTBOX_STORE_NAME: string
  OUTBOX_SYNC_TAG: string
  OUTBOX_MAX_RETRIES: number
  replayOutbox(
    fetchImpl?: (request: Request) => Promise<Response>,
  ): Promise<{ sent: number; failed: number; dropped: number; remaining: number }>
}

interface OutboxRecord {
  id: string
  url: string
  method: string
  headers: Record<string, string>
  body?: unknown
  createdAt: number
  retries: number
}

const swCoreSource = readFileSync(join(process.cwd(), "public/pwa/sw-core.js"), "utf8")
const swCore = new Function(
  `${swCoreSource}\n;return (typeof self !== "undefined" ? self : globalThis).SpindlePwa;`,
)() as SwCoreOutbox

/* ------------------------- fake IndexedDB ------------------------- */

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

const later = (fn: () => void) => queueMicrotask(fn)
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

function createStore(rows: Map<unknown, Record<string, unknown>>) {
  const request = <T>(produce: () => T) => {
    const req = new FakeIDBRequest<T>()
    later(() => {
      try {
        req.succeed(produce())
      } catch (error) {
        req.fail(error)
      }
    })
    return req
  }
  return {
    keyPath: "id",
    put: (row: Record<string, unknown>) =>
      request(() => {
        rows.set(row.id, row)
        return row.id
      }),
    delete: (key: unknown) =>
      request(() => {
        rows.delete(key)
      }),
    getAll: () => request(() => [...rows.values()]),
    count: () => request(() => rows.size),
    clear: () =>
      request(() => {
        rows.clear()
      }),
  }
}

type FakeStore = ReturnType<typeof createStore>

class FakeIDBDatabase {
  readonly name: string
  readonly objectStoreNames: { contains(name: string): boolean }
  private readonly stores = new Map<string, Map<unknown, Record<string, unknown>>>()

  constructor(name: string) {
    this.name = name
    this.objectStoreNames = { contains: (n) => this.stores.has(n) }
  }

  createObjectStore(name: string): FakeStore {
    const rows = new Map<unknown, Record<string, unknown>>()
    this.stores.set(name, rows)
    return createStore(rows)
  }

  storeRows(name: string): Map<unknown, Record<string, unknown>> {
    const rows = this.stores.get(name)
    if (!rows) throw new Error(`unknown object store: ${name}`)
    return rows
  }

  transaction(storeName: string, _mode?: string) {
    const rows = this.storeRows(storeName)
    return {
      error: null as unknown,
      onabort: null as (() => void) | null,
      objectStore: (_name?: string): FakeStore => createStore(rows),
    }
  }

  close() {}
}

const databases = new Map<string, FakeIDBDatabase>()

const fakeIndexedDB = {
  open: (name: string, _version?: number) => {
    const request = new FakeIDBRequest<FakeIDBDatabase>()
    later(() => {
      let db = databases.get(name)
      const upgrading = db === undefined
      if (!db) {
        db = new FakeIDBDatabase(name)
        databases.set(name, db)
      }
      request.result = db
      if (upgrading) request.onupgradeneeded?.()
      request.onsuccess?.()
    })
    return request
  },
}

/* --------------------------- helpers ------------------------------ */

function record(over: Partial<OutboxRecord>): OutboxRecord {
  return {
    id: over.id ?? `id-${Math.random().toString(36).slice(2)}`,
    url: "https://spindle.test/api/x",
    method: "POST",
    headers: {},
    createdAt: 0,
    retries: 0,
    ...over,
  }
}

function okResponse(status = 200): Response {
  return { ok: status >= 200 && status < 300, status } as Response
}

async function seed(records: OutboxRecord[]) {
  const req = fakeIndexedDB.open(swCore.OUTBOX_DB_NAME, 1)
  req.onupgradeneeded = () => {
    const db = req.result as unknown as FakeIDBDatabase
    if (!db.objectStoreNames.contains(swCore.OUTBOX_STORE_NAME)) {
      db.createObjectStore(swCore.OUTBOX_STORE_NAME)
    }
  }
  await new Promise<void>((resolve) => {
    req.onsuccess = () => resolve()
  })
  const db = req.result as unknown as FakeIDBDatabase
  const tx = db.transaction(swCore.OUTBOX_STORE_NAME)
  const store = tx.objectStore(swCore.OUTBOX_STORE_NAME)
  for (const r of records) {
    store.put(r as unknown as Record<string, unknown>)
  }
  await tick()
}

function rows(): Map<unknown, Record<string, unknown>> {
  const db = databases.get(swCore.OUTBOX_DB_NAME)
  if (!db) throw new Error("outbox db was never opened")
  return db.storeRows(swCore.OUTBOX_STORE_NAME)
}

beforeEach(() => {
  databases.clear()
  vi.stubGlobal("indexedDB", fakeIndexedDB)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("sw-core replayOutbox", () => {
  it("replays sequentially in createdAt order and deletes delivered records", async () => {
    await seed([
      record({ id: "c", url: "https://spindle.test/api/third", createdAt: 300 }),
      record({ id: "a", url: "https://spindle.test/api/first", createdAt: 100 }),
      record({ id: "b", url: "https://spindle.test/api/second", createdAt: 200 }),
    ])

    const order: string[] = []
    const result = await swCore.replayOutbox(async (request) => {
      order.push(request.url)
      return okResponse(200)
    })

    expect(order).toEqual([
      "https://spindle.test/api/first",
      "https://spindle.test/api/second",
      "https://spindle.test/api/third",
    ])
    expect(result).toEqual({ sent: 3, failed: 0, dropped: 0, remaining: 0 })
    expect(rows().size).toBe(0)
  })

  it("drops 4xx permanent failures without counting them as sent", async () => {
    await seed([record({ id: "a", createdAt: 1 })])

    const result = await swCore.replayOutbox(async () => okResponse(422))

    expect(result).toEqual({ sent: 0, failed: 0, dropped: 1, remaining: 0 })
    expect(rows().size).toBe(0)
  })

  it("keeps 5xx failures queued with an incremented retry counter", async () => {
    await seed([record({ id: "a", createdAt: 1 })])

    const result = await swCore.replayOutbox(async () => okResponse(500))

    expect(result).toEqual({ sent: 0, failed: 1, dropped: 0, remaining: 1 })
    const stored = rows().get("a") as unknown as OutboxRecord
    expect(stored.retries).toBe(1)
  })

  it("keeps network rejections queued", async () => {
    await seed([record({ id: "a", createdAt: 1 })])

    const result = await swCore.replayOutbox(async () => {
      throw new Error("offline")
    })

    expect(result).toEqual({ sent: 0, failed: 1, dropped: 0, remaining: 1 })
  })

  it("drops records that exceed the retry budget", async () => {
    await seed([record({ id: "a", createdAt: 1, retries: swCore.OUTBOX_MAX_RETRIES })])

    const result = await swCore.replayOutbox(async () => okResponse(500))

    expect(result).toEqual({ sent: 0, failed: 0, dropped: 1, remaining: 0 })
    expect(rows().size).toBe(0)
  })

  it("returns zeros for an empty outbox", async () => {
    await seed([])
    const fetchSpy = vi.fn()

    const result = await swCore.replayOutbox(fetchSpy)

    expect(result).toEqual({ sent: 0, failed: 0, dropped: 0, remaining: 0 })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("stops the chain on the first record's failure without skipping later records", async () => {
    // Sequential semantics: every record is still attempted in order even when
    // earlier ones fail — the queue order is preserved, failures just stay.
    await seed([
      record({ id: "a", url: "https://spindle.test/api/a", createdAt: 1 }),
      record({ id: "b", url: "https://spindle.test/api/b", createdAt: 2 }),
    ])

    const order: string[] = []
    const result = await swCore.replayOutbox(async (request) => {
      order.push(request.url)
      return request.url.endsWith("/a") ? okResponse(503) : okResponse(200)
    })

    expect(order).toEqual(["https://spindle.test/api/a", "https://spindle.test/api/b"])
    expect(result).toEqual({ sent: 1, failed: 1, dropped: 0, remaining: 1 })
  })
})
