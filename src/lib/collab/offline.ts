import type { CrdtOp } from "./crdt"

/**
 * Offline-first op queue.
 *
 * Local ops are appended here when there is no live connection and flushed
 * in causal (append) order on reconnect. Persistence uses IndexedDB when
 * available, localStorage otherwise, and an in-memory store as a last
 * resort (tests, SSR).
 *
 * The storage layer is async; the queue serialises operations through a
 * simple promise chain so callers never need to think about ordering.
 */

export interface OpQueueStorage {
  load(key: string): Promise<CrdtOp[]>
  save(key: string, ops: CrdtOp[]): Promise<void>
  clear(key: string): Promise<void>
}

const memoryStore = new Map<string, CrdtOp[]>()

/** Synchronous in-memory storage — default for tests/SSR. */
export const memoryStorage: OpQueueStorage = {
  async load(key) {
    return [...(memoryStore.get(key) ?? [])]
  },
  async save(key, ops) {
    if (ops.length) memoryStore.set(key, [...ops])
    else memoryStore.delete(key)
  },
  async clear(key) {
    memoryStore.delete(key)
  },
}

/** localStorage-backed storage (works everywhere, ~5MB limit). */
export function localStorageStorage(prefix = "collab:queue:"): OpQueueStorage {
  return {
    async load(key) {
      try {
        const raw = globalThis.localStorage?.getItem(prefix + key)
        return raw ? (JSON.parse(raw) as CrdtOp[]) : []
      } catch {
        return []
      }
    },
    async save(key, ops) {
      try {
        if (ops.length) {
          globalThis.localStorage?.setItem(prefix + key, JSON.stringify(ops))
        } else {
          globalThis.localStorage?.removeItem(prefix + key)
        }
      } catch {
        // Quota exceeded — degrade silently; ops remain in memory chain.
      }
    },
    async clear(key) {
      try {
        globalThis.localStorage?.removeItem(prefix + key)
      } catch {
        /* ignore */
      }
    },
  }
}

/** IndexedDB-backed storage (preferred for larger queues). */
export function indexedDBStorage(dbName = "spindle-collab", store = "op-queue"): OpQueueStorage {
  const open = (): Promise<IDBDatabase> =>
    new Promise((resolve, reject) => {
      const req = indexedDB.open(dbName, 1)
      req.onupgradeneeded = () => {
        req.result.createObjectStore(store)
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })

  const tx = async <T>(
    mode: IDBTransactionMode,
    run: (s: IDBObjectStore) => IDBRequest,
  ): Promise<T> => {
    const db = await open()
    return new Promise((resolve, reject) => {
      const t = db.transaction(store, mode)
      const req = run(t.objectStore(store))
      req.onsuccess = () => resolve(req.result as T)
      req.onerror = () => {
        // Without this the connection leaks: t.oncomplete never fires on a
        // failed request and db.close() would never run.
        db.close()
        reject(req.error)
      }
      t.oncomplete = () => db.close()
      t.onabort = () => db.close()
    })
  }

  return {
    async load(key) {
      const ops = await tx<CrdtOp[] | undefined>(
        "readonly",
        (s) => s.get(key) as IDBRequest<CrdtOp[]>,
      )
      return ops ?? []
    },
    async save(key, ops) {
      await tx("readwrite", (s) => (ops.length ? s.put(ops, key) : s.delete(key)) as IDBRequest)
    },
    async clear(key) {
      await tx("readwrite", (s) => s.delete(key) as IDBRequest)
    },
  }
}

/** Pick the best available storage for this environment. */
export function defaultStorage(): OpQueueStorage {
  if (typeof indexedDB !== "undefined") return indexedDBStorage()
  if (typeof localStorage !== "undefined") return localStorageStorage()
  return memoryStorage
}

export class OfflineOpQueue {
  private ops: CrdtOp[] = []
  private chain: Promise<unknown> = Promise.resolve()
  private loaded = false

  constructor(
    private readonly key: string,
    private readonly storage: OpQueueStorage = defaultStorage(),
  ) {}

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.chain.then(fn, fn)
    this.chain = p.catch(() => {})
    return p
  }

  /** Internal loader — must only be called inside an enqueued task. */
  private async ensureLoaded() {
    if (!this.loaded) {
      this.ops = await this.storage.load(this.key)
      this.loaded = true
    }
  }

  /** Restore persisted ops. Idempotent; call once at startup. */
  async load(): Promise<CrdtOp[]> {
    return this.enqueue(async () => {
      await this.ensureLoaded()
      return [...this.ops]
    })
  }

  /** Append ops (already in causal order) and persist. */
  async push(...newOps: CrdtOp[]): Promise<void> {
    return this.enqueue(async () => {
      await this.ensureLoaded()
      this.ops.push(...newOps)
      await this.storage.save(this.key, this.ops)
    })
  }

  /** Current queued ops in causal order (snapshot). */
  async pending(): Promise<CrdtOp[]> {
    await this.load()
    return [...this.ops]
  }

  get size(): number {
    return this.ops.length
  }

  /**
   * Flush queued ops through `send`. Ops are delivered strictly in order;
   * the first failure stops the flush and keeps the remainder queued.
   * Returns the number of ops successfully sent.
   */
  async flush(send: (op: CrdtOp) => Promise<boolean>): Promise<number> {
    return this.enqueue(async () => {
      await this.ensureLoaded()
      let sent = 0
      while (this.ops.length) {
        const ok = await send(this.ops[0])
        if (!ok) break
        this.ops.shift()
        sent++
        // Persist progress so a crash mid-flush doesn't resend everything
        // (CRDT ops are idempotent anyway, but this keeps the queue small).
        await this.storage.save(this.key, this.ops)
      }
      return sent
    })
  }

  /** Drop the queue (e.g. document deleted). */
  async clear(): Promise<void> {
    return this.enqueue(async () => {
      this.ops = []
      await this.storage.clear(this.key)
    })
  }
}
