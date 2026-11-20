import { readFileSync } from "node:fs"
import { join } from "node:path"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  clearOutbox,
  enqueueMutation,
  installBackgroundSync,
  outboxSize,
  replayOutboxNow,
  type QueuedMutation,
} from "./background-sync"

/**
 * Minimal in-memory IndexedDB fake — just enough surface for
 * src/lib/pwa/background-sync.ts (open/transaction/store CRUD). No
 * fake-indexeddb dependency is added; requests resolve on microtasks,
 * matching the real async callback style.
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

function createStore(rows: RowMap) {
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
    add: (row: Row) =>
      request(() => {
        rows.set(row.id, row)
        return row.id
      }),
    put: (row: Row) =>
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
  private readonly stores = new Map<string, RowMap>()

  constructor(name: string) {
    this.name = name
    this.objectStoreNames = { contains: (n) => this.stores.has(n) }
  }

  createObjectStore(name: string): FakeStore {
    const rows: RowMap = new Map()
    this.stores.set(name, rows)
    return createStore(rows)
  }

  storeRows(name: string): RowMap {
    const rows = this.stores.get(name)
    if (!rows) throw new Error(`unknown object store: ${name}`)
    return rows
  }

  transaction(storeName: string) {
    return {
      error: null as unknown,
      onabort: null as (() => void) | null,
      objectStore: (): FakeStore => createStore(this.storeRows(storeName)),
    }
  }

  close() {}
}

interface SwCoreConstants {
  OUTBOX_DB_NAME: string
  OUTBOX_STORE_NAME: string
  OUTBOX_SYNC_TAG: string
}

const swCoreSource = readFileSync(join(process.cwd(), "public/pwa/sw-core.js"), "utf8")
const swCore = new Function(
  `${swCoreSource}\n;return (typeof self !== "undefined" ? self : globalThis).SpindlePwa;`,
)() as SwCoreConstants

const databases = new Map<string, FakeIDBDatabase>()
const openSpy = vi.fn((name: string) => {
  const request = new FakeIDBRequest<FakeIDBDatabase>()
  queueMicrotask(() => {
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
})

const fakeIndexedDB = { open: openSpy }

const originalFetch = globalThis.fetch
const originalWindowFetch = window.fetch

function setFetch(mock: ReturnType<typeof vi.fn>) {
  globalThis.fetch = mock as unknown as typeof fetch
  window.fetch = mock as unknown as typeof fetch
}

function outboxRows(): RowMap {
  const db = databases.get(swCore.OUTBOX_DB_NAME)
  if (!db) throw new Error("outbox database was never opened")
  return db.storeRows(swCore.OUTBOX_STORE_NAME)
}

function okResponse(status = 200): Response {
  return { ok: status >= 200 && status < 300, status } as Response
}

beforeEach(() => {
  databases.clear()
  openSpy.mockClear()
  Object.defineProperty(globalThis, "indexedDB", {
    value: fakeIndexedDB,
    configurable: true,
    writable: true,
  })
})

afterEach(() => {
  globalThis.fetch = originalFetch
  window.fetch = originalWindowFetch
})

describe("enqueueMutation / outboxSize", () => {
  it("queues a mutation with an id, uppercased method and retry counter", async () => {
    await enqueueMutation({
      url: "/api/projects",
      method: "post",
      headers: { "content-type": "application/json" },
      body: "{}",
    })

    expect(await outboxSize()).toBe(1)
    const rows = [...outboxRows().values()] as unknown as QueuedMutation[]
    expect(rows).toHaveLength(1)
    const record = rows[0]
    expect(record.method).toBe("POST")
    expect(record.url).toBe("/api/projects")
    expect(record.headers).toEqual({ "content-type": "application/json" })
    expect(record.body).toBe("{}")
    expect(record.retries).toBe(0)
    expect(record.createdAt).toBeGreaterThan(0)
    expect(typeof record.id).toBe("string")
  })

  it("defaults headers to an empty record", async () => {
    await enqueueMutation({ url: "/api/x", method: "DELETE" })
    const rows = [...outboxRows().values()] as unknown as QueuedMutation[]
    expect(rows[0].headers).toEqual({})
    expect(rows[0].body).toBeUndefined()
  })

  it("resolves silently when indexedDB is unavailable", async () => {
    Object.defineProperty(globalThis, "indexedDB", {
      value: undefined,
      configurable: true,
      writable: true,
    })
    await expect(enqueueMutation({ url: "/api/x", method: "POST" })).resolves.toBeUndefined()
    await expect(outboxSize()).resolves.toBe(0)
    await expect(replayOutboxNow()).resolves.toEqual({
      sent: 0,
      failed: 0,
      dropped: 0,
      remaining: 0,
    })
    await expect(clearOutbox()).resolves.toBeUndefined()
  })

  it("uses the same db/store/tag constants as public/pwa/sw-core.js", async () => {
    await enqueueMutation({ url: "/api/x", method: "POST" })
    expect(openSpy).toHaveBeenCalledWith(swCore.OUTBOX_DB_NAME, 1)
    expect(swCore.OUTBOX_DB_NAME).toBe("spindle-outbox")
    expect(swCore.OUTBOX_STORE_NAME).toBe("requests")
    expect(swCore.OUTBOX_SYNC_TAG).toBe("spindle-outbox")
  })
})

describe("installBackgroundSync", () => {
  it("queues same-origin mutating requests that fail with a 5xx", async () => {
    const fetchMock = vi.fn(async () => okResponse(503))
    setFetch(fetchMock)
    const uninstall = installBackgroundSync()

    const response = await fetch("/api/projects", { method: "POST", body: "x" })

    expect(response.status).toBe(503)
    expect(await outboxSize()).toBe(1)
    uninstall()
  })

  it("queues same-origin mutating requests that reject at the network level", async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError("network down")
    })
    setFetch(fetchMock)
    const uninstall = installBackgroundSync()

    await expect(fetch("/api/projects", { method: "PUT" })).rejects.toThrow("network down")
    expect(await outboxSize()).toBe(1)
    uninstall()
  })

  it("does not queue successful responses or 4xx client errors", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(okResponse(200))
      .mockResolvedValueOnce(okResponse(404))
    setFetch(fetchMock)
    const uninstall = installBackgroundSync()

    await fetch("/api/a", { method: "POST" })
    await fetch("/api/b", { method: "DELETE" })

    expect(await outboxSize()).toBe(0)
    uninstall()
  })

  it("ignores GET/HEAD requests and cross-origin mutations", async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError("network down")
    })
    setFetch(fetchMock)
    const uninstall = installBackgroundSync()

    await expect(fetch("/api/read")).rejects.toThrow()
    await expect(fetch("https://other.example.com/api/x", { method: "POST" })).rejects.toThrow()

    expect(await outboxSize()).toBe(0)
    uninstall()
  })

  it("restores window.fetch on uninstall", async () => {
    setFetch(vi.fn(async () => okResponse(200)))
    const before = window.fetch
    const uninstall = installBackgroundSync()
    expect(window.fetch).not.toBe(before)
    uninstall()
    expect(window.fetch).toBe(before)
  })

  it("is a no-op outside the browser", () => {
    // jsdom always has window; just assert the returned function is callable.
    const uninstall = installBackgroundSync()
    expect(() => uninstall()).not.toThrow()
  })
})

describe("replayOutboxNow", () => {
  it("sends queued mutations and removes them on success", async () => {
    await enqueueMutation({ url: "/api/a", method: "POST", body: "1" })
    await enqueueMutation({ url: "/api/b", method: "PATCH" })
    setFetch(vi.fn(async () => okResponse(200)))

    const result = await replayOutboxNow()

    expect(result).toEqual({ sent: 2, failed: 0, dropped: 0, remaining: 0 })
    expect(await outboxSize()).toBe(0)
  })

  it("drops permanently-failing 4xx responses without retrying", async () => {
    await enqueueMutation({ url: "/api/a", method: "POST" })
    setFetch(vi.fn(async () => okResponse(422)))

    const result = await replayOutboxNow()

    // 4xx is a permanent failure: removed from the outbox but NOT counted as sent.
    expect(result).toEqual({ sent: 0, failed: 0, dropped: 1, remaining: 0 })
  })

  it("keeps retryable failures in the outbox with an incremented counter", async () => {
    await enqueueMutation({ url: "/api/a", method: "POST" })
    setFetch(vi.fn(async () => okResponse(500)))

    const result = await replayOutboxNow()

    expect(result).toEqual({ sent: 0, failed: 1, dropped: 0, remaining: 1 })
    const rows = [...outboxRows().values()] as unknown as QueuedMutation[]
    expect(rows[0].retries).toBe(1)
  })

  it("counts network rejections as failures", async () => {
    await enqueueMutation({ url: "/api/a", method: "POST" })
    setFetch(
      vi.fn(async () => {
        throw new Error("offline")
      }),
    )

    const result = await replayOutboxNow()

    expect(result).toEqual({ sent: 0, failed: 1, dropped: 0, remaining: 1 })
  })

  it("drops records that exceed the retry budget", async () => {
    await enqueueMutation({ url: "/api/a", method: "POST" })
    const row = [...outboxRows().values()][0] as unknown as QueuedMutation
    row.retries = 5 // MAX_RETRIES — one more failure deletes it

    setFetch(vi.fn(async () => okResponse(500)))
    const result = await replayOutboxNow()

    expect(result).toEqual({ sent: 0, failed: 0, dropped: 1, remaining: 0 })
  })

  it("does not send a body for GET/HEAD replays", async () => {
    await enqueueMutation({ url: "/api/a", method: "GET", body: "should-not-send" })
    const fetchMock = vi.fn(async () => okResponse(200))
    setFetch(fetchMock)

    await replayOutboxNow()

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/a",
      expect.objectContaining({ method: "GET", body: undefined }),
    )
  })

  it("replays mutations sequentially in enqueue (createdAt) order", async () => {
    // Insert out of order on purpose; getAll returns key order, not enqueue order.
    await enqueueMutation({ url: "/api/third", method: "POST" })
    await enqueueMutation({ url: "/api/first", method: "POST" })
    await enqueueMutation({ url: "/api/second", method: "POST" })

    const rows = [...outboxRows().values()] as unknown as QueuedMutation[]
    rows.find((r) => r.url === "/api/first")!.createdAt = 100
    rows.find((r) => r.url === "/api/second")!.createdAt = 200
    rows.find((r) => r.url === "/api/third")!.createdAt = 300

    const order: string[] = []
    setFetch(
      vi.fn(async (input: RequestInfo | URL) => {
        order.push(String(input))
        return okResponse(200)
      }),
    )

    const result = await replayOutboxNow()

    expect(result.sent).toBe(3)
    expect(order).toEqual(["/api/first", "/api/second", "/api/third"])
  })

  it("replays through the unwrapped fetch — failures do not re-enqueue duplicates", async () => {
    // Install the interceptor with a fetch that always fails at network level.
    const failingFetch = vi.fn(async () => {
      throw new TypeError("network down")
    })
    setFetch(failingFetch)
    const uninstall = installBackgroundSync()

    await expect(fetch("/api/projects", { method: "POST" })).rejects.toThrow()
    expect(await outboxSize()).toBe(1)

    // A replay attempt fails too — but must NOT queue a second copy of itself.
    const result = await replayOutboxNow()

    expect(result).toEqual({ sent: 0, failed: 1, dropped: 0, remaining: 1 })
    expect(await outboxSize()).toBe(1)
    // Two fetch calls total: the original request + the replay. A third call
    // would mean the replay went through the wrapper and re-queued.
    expect(failingFetch).toHaveBeenCalledTimes(2)

    uninstall()
  })

  it("replays successfully through the captured fetch and drains the outbox", async () => {
    let shouldFail = true
    const flakyFetch = vi.fn(async () => {
      if (shouldFail) throw new TypeError("network down")
      return okResponse(200)
    })
    setFetch(flakyFetch)
    const uninstall = installBackgroundSync()

    await expect(fetch("/api/projects", { method: "POST" })).rejects.toThrow()
    expect(await outboxSize()).toBe(1)

    shouldFail = false
    const result = await replayOutboxNow()

    expect(result).toEqual({ sent: 1, failed: 0, dropped: 0, remaining: 0 })
    expect(await outboxSize()).toBe(0)
    // Still exactly two calls — the replay bypassed the wrapper entirely.
    expect(flakyFetch).toHaveBeenCalledTimes(2)

    uninstall()
  })
})

describe("clearOutbox", () => {
  it("removes every queued mutation", async () => {
    await enqueueMutation({ url: "/api/a", method: "POST" })
    await enqueueMutation({ url: "/api/b", method: "PUT" })
    expect(await outboxSize()).toBe(2)

    await clearOutbox()

    expect(await outboxSize()).toBe(0)
  })
})
