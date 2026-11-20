/**
 * Background Sync outbox for failed mutations.
 *
 * `installBackgroundSync()` wraps `window.fetch` so that same-origin
 * non-GET requests which fail at the network level (or return 5xx) are queued
 * in IndexedDB and replayed later — either by the service worker's `sync`
 * event (public/sw.js) or manually via `replayOutboxNow()` when the Background
 * Sync API is unavailable.
 *
 * The database name, store name and sync tag MUST match the constants in
 * public/pwa/sw-core.js (OUTBOX_DB_NAME / OUTBOX_STORE_NAME / OUTBOX_SYNC_TAG),
 * which the service worker uses to replay the queue.
 */

const OUTBOX_DB_NAME = "spindle-outbox"
const OUTBOX_STORE_NAME = "requests"
const OUTBOX_SYNC_TAG = "spindle-outbox"
const MAX_RETRIES = 5

export interface QueuedMutation {
  id: string
  url: string
  method: string
  headers: Record<string, string>
  /** Structured-cloneable request body (string, FormData, Blob, ArrayBuffer, URLSearchParams). */
  body?: unknown
  createdAt: number
  retries: number
}

interface EnqueueInput {
  url: string
  method: string
  headers?: Record<string, string>
  body?: unknown
}

function openOutboxDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(OUTBOX_DB_NAME, 1)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(OUTBOX_STORE_NAME)) {
        db.createObjectStore(OUTBOX_STORE_NAME, { keyPath: "id" })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function idbTransaction<T>(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(OUTBOX_STORE_NAME, mode)
    const request = run(tx.objectStore(OUTBOX_STORE_NAME))
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
    tx.onabort = () => reject(tx.error)
  })
}

/** Queue a failed mutation for later replay. Safe to call when unsupported — resolves silently. */
export async function enqueueMutation(input: EnqueueInput): Promise<void> {
  if (typeof indexedDB === "undefined") return
  try {
    const db = await openOutboxDb()
    try {
      const record: QueuedMutation = {
        id:
          typeof crypto !== "undefined" && "randomUUID" in crypto
            ? crypto.randomUUID()
            : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        url: input.url,
        method: input.method.toUpperCase(),
        headers: input.headers ?? {},
        body: input.body,
        createdAt: Date.now(),
        retries: 0,
      }
      await idbTransaction(db, "readwrite", (store) => store.add(record))
    } finally {
      db.close()
    }
    await registerSync()
  } catch {
    // Outbox persistence is best-effort; never break the app over it.
  }
}

async function registerSync(): Promise<void> {
  try {
    const registration = await navigator.serviceWorker?.ready
    // Background Sync types aren't in lib.dom; check structurally.
    const syncManager = (
      registration as unknown as { sync?: { register?: (tag: string) => Promise<void> } }
    )?.sync
    if (syncManager?.register) {
      await syncManager.register(OUTBOX_SYNC_TAG)
    }
  } catch {
    // Background Sync unsupported or registration raced — replayOutboxNow covers it.
  }
}

/** Number of mutations currently waiting in the outbox. */
export async function outboxSize(): Promise<number> {
  if (typeof indexedDB === "undefined") return 0
  const db = await openOutboxDb()
  try {
    return await idbTransaction(db, "readonly", (store) => store.count())
  } finally {
    db.close()
  }
}

export interface ReplayResult {
  /** Delivered with a 2xx response. */
  sent: number
  /** Still queued after this attempt (retryable failure). */
  failed: number
  /** Removed without delivery (4xx permanent failure or retry budget exhausted). */
  dropped: number
  remaining: number
}

/**
 * The unwrapped `fetch` captured by `installBackgroundSync`. Replays MUST go
 * through this — replaying via `window.fetch` would re-enter the interceptor,
 * and a still-failing replay would enqueue a duplicate of itself forever.
 */
let replayFetch: typeof fetch | null = null

function isPermanentFailure(response: Response): boolean {
  // 4xx means the server understood and rejected the request — retrying won't help.
  return response.status >= 400 && response.status < 500
}

/** Bump a record's retry counter; resolves true when it stays queued. */
async function bumpRecord(db: IDBDatabase, record: QueuedMutation): Promise<boolean> {
  record.retries += 1
  if (record.retries > MAX_RETRIES) {
    await idbTransaction(db, "readwrite", (store) => store.delete(record.id))
    return false
  }
  await idbTransaction(db, "readwrite", (store) => store.put(record))
  return true
}

/**
 * Replay queued mutations immediately, strictly sequentially in enqueue
 * (createdAt) order — create-then-update mutations must not overtake each
 * other. Used as a fallback when `sync` events don't fire.
 */
export async function replayOutboxNow(): Promise<ReplayResult> {
  if (typeof indexedDB === "undefined") {
    return { sent: 0, failed: 0, dropped: 0, remaining: 0 }
  }

  const doFetch = replayFetch ?? fetch
  const db = await openOutboxDb()
  try {
    const records = await idbTransaction<QueuedMutation[]>(
      db,
      "readonly",
      (store) => store.getAll() as IDBRequest<QueuedMutation[]>,
    )

    // Enqueue order = creation order; getAll returns key order.
    const ordered = records.slice().sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))

    let sent = 0
    let failed = 0
    let dropped = 0

    for (const record of ordered) {
      try {
        const response = await doFetch(record.url, {
          method: record.method,
          headers: record.headers,
          body:
            record.method === "GET" || record.method === "HEAD"
              ? undefined
              : (record.body as BodyInit | undefined),
          credentials: "same-origin",
        })
        if (response.ok) {
          await idbTransaction(db, "readwrite", (store) => store.delete(record.id))
          sent++
        } else if (isPermanentFailure(response)) {
          await idbTransaction(db, "readwrite", (store) => store.delete(record.id))
          dropped++
        } else {
          const kept = await bumpRecord(db, record)
          if (kept) failed++
          else dropped++
        }
      } catch {
        const kept = await bumpRecord(db, record)
        if (kept) failed++
        else dropped++
      }
    }

    const remaining = await idbTransaction<number>(db, "readonly", (store) => store.count())
    return { sent, failed, dropped, remaining }
  } finally {
    db.close()
  }
}

/** Remove every queued mutation (e.g. on sign-out). */
export async function clearOutbox(): Promise<void> {
  if (typeof indexedDB === "undefined") return
  const db = await openOutboxDb()
  try {
    await idbTransaction(db, "readwrite", (store) => store.clear())
  } finally {
    db.close()
  }
}

/**
 * Fallback replay for browsers without the Background Sync API (and for the
 * window before the first `sync` event fires). Replays the outbox:
 *   - immediately whenever the browser fires `online`, and
 *   - on a fixed interval while the page is visible.
 *
 * `registerSync()` in the service worker path is still attempted by
 * `enqueueMutation`; this polling is the belt-and-suspenders path so queued
 * mutations are never stranded on browsers that lack `registration.sync`.
 *
 * Returns a stop function. `replay` and `target` are injectable for tests.
 */
export interface OutboxPollingOptions {
  /** Poll interval in ms. Default 60_000. */
  intervalMs?: number
  /** Replay implementation — defaults to `replayOutboxNow`. */
  replay?: () => Promise<ReplayResult>
  /** Event target for `online` — defaults to `window`, null disables it. */
  target?: Pick<Window, "addEventListener" | "removeEventListener"> | null
  /** Optional observer for each replay result (telemetry/debug). */
  onResult?: (result: ReplayResult) => void
}

const DEFAULT_POLL_INTERVAL_MS = 60_000

export function startOutboxPolling(options: OutboxPollingOptions = {}): () => void {
  const replay = options.replay ?? replayOutboxNow
  const intervalMs = options.intervalMs ?? DEFAULT_POLL_INTERVAL_MS
  const target =
    options.target === undefined ? (typeof window !== "undefined" ? window : null) : options.target

  let stopped = false
  let inFlight = false

  const run = async () => {
    // Skip overlapping runs — replayOutboxNow rewrites the outbox as it goes.
    if (inFlight || stopped) return
    inFlight = true
    try {
      const result = await replay()
      if (!stopped) options.onResult?.(result)
    } catch {
      // replayOutboxNow is best-effort; polling must never throw.
    } finally {
      inFlight = false
    }
  }

  const onOnline = () => {
    void run()
  }

  target?.addEventListener("online", onOnline)
  const interval =
    typeof setInterval === "function" ? setInterval(() => void run(), intervalMs) : null

  // One immediate pass so a queue left over from a previous session drains
  // as soon as the app boots, even without Background Sync.
  void run()

  return () => {
    stopped = true
    target?.removeEventListener("online", onOnline)
    if (interval !== null) clearInterval(interval)
  }
}

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"])

function headersToRecord(headers: HeadersInit | undefined): Record<string, string> {
  if (!headers) return {}
  if (headers instanceof Headers) {
    const record: Record<string, string> = {}
    headers.forEach((value, key) => {
      record[key] = value
    })
    return record
  }
  if (Array.isArray(headers)) {
    return Object.fromEntries(headers)
  }
  return { ...headers }
}

/**
 * Wrap `window.fetch` so failed same-origin mutations land in the outbox.
 * Returns an uninstall function. Only active in browsers; no-ops elsewhere.
 */
export function installBackgroundSync(): () => void {
  if (typeof window === "undefined" || typeof window.fetch !== "function") {
    return () => {}
  }

  const originalFetch = window.fetch
  const boundFetch = originalFetch.bind(window)
  // Replays must bypass this wrapper — see replayOutboxNow.
  replayFetch = boundFetch

  window.fetch = async function spindledFetch(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    const method = String(
      init?.method ?? (input instanceof Request ? input.method : "GET"),
    ).toUpperCase()

    const shouldQueue =
      MUTATING_METHODS.has(method) &&
      typeof indexedDB !== "undefined" &&
      (() => {
        try {
          const url =
            typeof input === "string"
              ? input
              : input instanceof URL
                ? input.href
                : input instanceof Request
                  ? input.url
                  : String(input)
          return new URL(url, window.location.origin).origin === window.location.origin
        } catch {
          return false
        }
      })()

    if (!shouldQueue) {
      return boundFetch(input, init)
    }

    try {
      const response = await boundFetch(input, init)
      // Queue retryable server failures; client errors are the caller's problem.
      if (response.status >= 500) {
        await queueFromInput(input, init, method)
      }
      return response
    } catch (error) {
      await queueFromInput(input, init, method)
      throw error
    }
  }

  return () => {
    window.fetch = originalFetch
    if (replayFetch === boundFetch) replayFetch = null
  }
}

async function queueFromInput(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  method: string,
): Promise<void> {
  try {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input instanceof Request
            ? input.url
            : String(input)

    const headers = headersToRecord(
      init?.headers ?? (input instanceof Request ? input.headers : undefined),
    )

    let body: unknown
    if (init?.body !== undefined && init.body !== null) {
      body = init.body
    } else if (input instanceof Request && method !== "GET" && method !== "HEAD") {
      try {
        body = await input.clone().arrayBuffer()
      } catch {
        body = undefined
      }
    }

    await enqueueMutation({ url, method, headers, body })
  } catch {
    // Best-effort queueing only.
  }
}
