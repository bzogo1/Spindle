/**
 * Serializable upload-queue state persistence.
 *
 * Only metadata is persisted (never File/Blob contents): the object key,
 * multipart session id, part size and per-part etags. On reload the user
 * re-selects the same file and the queue resumes the multipart upload,
 * skipping parts the backend already acknowledged.
 */

export interface PersistedPart {
  partNumber: number
  etag: string
}

export interface PersistedUpload {
  id: string
  /** Stable file identity used to match a re-selected File. */
  fileKey: string
  fileName: string
  size: number
  contentType?: string
  /** Object key / destination name sent to the transport. */
  key: string
  /** Multipart session / upload id, when init already happened. */
  uploadId?: string
  /** Chunk size used to derive part numbers. */
  partSize: number
  /** Parts already acknowledged by the backend. */
  uploadedParts: PersistedPart[]
  status: "queued" | "uploading" | "paused" | "completed" | "error" | "cancelled"
  lastError?: string
  updatedAt: number
}

export function fileKeyFor(file: { name: string; size: number; lastModified?: number }): string {
  return `${file.name}:${file.size}:${file.lastModified ?? 0}`
}

export interface UploadStateStore {
  load(): Promise<PersistedUpload[]>
  save(entry: PersistedUpload): Promise<void>
  remove(id: string): Promise<void>
  clear(): Promise<void>
}

/* ------------------------------------------------------------------ */
/* In-memory store (tests, SSR fallback)                               */
/* ------------------------------------------------------------------ */

export class MemoryUploadStore implements UploadStateStore {
  private entries = new Map<string, PersistedUpload>()

  async load(): Promise<PersistedUpload[]> {
    return [...this.entries.values()].map((e) => ({
      ...e,
      uploadedParts: e.uploadedParts.map((p) => ({ ...p })),
    }))
  }
  async save(entry: PersistedUpload): Promise<void> {
    this.entries.set(entry.id, {
      ...entry,
      uploadedParts: entry.uploadedParts.map((p) => ({ ...p })),
    })
  }
  async remove(id: string): Promise<void> {
    this.entries.delete(id)
  }
  async clear(): Promise<void> {
    this.entries.clear()
  }
}

/* ------------------------------------------------------------------ */
/* localStorage store (small state, synchronous, widely supported)     */
/* ------------------------------------------------------------------ */

const LS_KEY = "spindle:upload-queue:v1"
const LS_MAX_BYTES = 512 * 1024

export class LocalStorageUploadStore implements UploadStateStore {
  async load(): Promise<PersistedUpload[]> {
    try {
      const raw = globalThis.localStorage?.getItem(LS_KEY)
      if (!raw) return []
      const parsed = JSON.parse(raw) as PersistedUpload[]
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }

  async save(entry: PersistedUpload): Promise<void> {
    try {
      const all = (await this.load()).filter((e) => e.id !== entry.id)
      all.push(entry)
      const serialized = JSON.stringify(all)
      if (serialized.length > LS_MAX_BYTES) {
        // Drop completed entries first; they no longer need resume state.
        const trimmed = all.filter((e) => e.status !== "completed")
        globalThis.localStorage?.setItem(LS_KEY, JSON.stringify(trimmed))
      } else {
        globalThis.localStorage?.setItem(LS_KEY, serialized)
      }
    } catch {
      // Quota exceeded or unavailable — persistence is best-effort.
    }
  }

  async remove(id: string): Promise<void> {
    try {
      const all = (await this.load()).filter((e) => e.id !== id)
      globalThis.localStorage?.setItem(LS_KEY, JSON.stringify(all))
    } catch {
      // ignore
    }
  }

  async clear(): Promise<void> {
    try {
      globalThis.localStorage?.removeItem(LS_KEY)
    } catch {
      // ignore
    }
  }
}

/* ------------------------------------------------------------------ */
/* IndexedDB store (preferred when available)                          */
/* ------------------------------------------------------------------ */

const IDB_NAME = "spindle-uploads"
const IDB_STORE = "entries"
const IDB_VERSION = 1

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB unavailable"))
      return
    }
    const request = indexedDB.open(IDB_NAME, IDB_VERSION)
    request.onupgradeneeded = () => {
      request.result.createObjectStore(IDB_STORE, { keyPath: "id" })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"))
  })
}

export class IndexedDbUploadStore implements UploadStateStore {
  private dbPromise?: Promise<IDBDatabase>

  private db(): Promise<IDBDatabase> {
    this.dbPromise ??= openDb()
    return this.dbPromise
  }

  async load(): Promise<PersistedUpload[]> {
    const db = await this.db()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readonly")
      const request = tx.objectStore(IDB_STORE).getAll()
      request.onsuccess = () => resolve((request.result as PersistedUpload[]) ?? [])
      request.onerror = () => reject(request.error ?? new Error("IndexedDB getAll failed"))
    })
  }

  async save(entry: PersistedUpload): Promise<void> {
    const db = await this.db()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readwrite")
      tx.objectStore(IDB_STORE).put({
        ...entry,
        uploadedParts: entry.uploadedParts.map((p) => ({ ...p })),
      })
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error("IndexedDB put failed"))
      tx.onabort = () => reject(tx.error ?? new Error("IndexedDB put aborted"))
    })
  }

  async remove(id: string): Promise<void> {
    const db = await this.db()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readwrite")
      tx.objectStore(IDB_STORE).delete(id)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error("IndexedDB delete failed"))
    })
  }

  async clear(): Promise<void> {
    const db = await this.db()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readwrite")
      tx.objectStore(IDB_STORE).clear()
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error("IndexedDB clear failed"))
    })
  }
}

/**
 * Pick the best available store: IndexedDB → localStorage → memory.
 * All failures degrade silently since persistence is best-effort.
 */
export function createDefaultStore(): UploadStateStore {
  if (typeof indexedDB !== "undefined") return new IndexedDbUploadStore()
  if (typeof globalThis.localStorage !== "undefined") return new LocalStorageUploadStore()
  return new MemoryUploadStore()
}
