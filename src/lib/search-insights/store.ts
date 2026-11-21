import { SEARCH_EVENTS_SCHEMA_VERSION, validateSearchEvent, type SearchEvent } from "./schema"

/**
 * localStorage-backed event store for search analytics.
 *
 * Events live in a bounded ring buffer under a single key as
 * `{ version, events }`. The `version` field is the schema-versioning hook:
 * reads from a different version run through `migrate` (currently a
 * pass-through that keeps compatible events and drops the rest) so future
 * schema changes can transform old data instead of losing it.
 *
 * Also provides batch-flush helpers (task 48): `flushEvents` persists any
 * queued-but-unwritten events, and `onFlush`/`subscribeToFlush` let a
 * future network transport drain the buffer without the store knowing
 * about it.
 */

export const SEARCH_EVENTS_STORAGE_KEY = "spindle-search-insights-events"
/** Max events retained in the ring buffer (oldest dropped first). */
export const MAX_STORED_EVENTS = 1000
/** Events per storage write when batching appends. */
export const BATCH_FLUSH_SIZE = 25

export type StoredSearchEvents = {
  version: number
  events: SearchEvent[]
}

export type FlushListener = (events: SearchEvent[]) => void

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage
  } catch {
    return null
  }
}

/**
 * Migrate a stored payload to the current schema version. v1 is the first
 * version, so this only needs to handle "unknown future/older version" by
 * keeping events that still validate.
 */
export function migrateStoredEvents(
  payload: unknown,
  targetVersion: number = SEARCH_EVENTS_SCHEMA_VERSION,
): StoredSearchEvents {
  if (typeof payload !== "object" || payload === null) {
    return { version: targetVersion, events: [] }
  }
  const record = payload as { version?: unknown; events?: unknown }
  const rawEvents = Array.isArray(record.events) ? record.events : []
  const events: SearchEvent[] = []
  for (const value of rawEvents) {
    if (validateSearchEvent(value)) {
      // Re-stamp events written under an older schema version.
      events.push({ ...value, schemaVersion: targetVersion })
    }
  }
  return { version: targetVersion, events }
}

export function readStoredEvents(): SearchEvent[] {
  const store = storage()
  if (!store) return []
  let raw: string | null
  try {
    raw = store.getItem(SEARCH_EVENTS_STORAGE_KEY)
  } catch {
    return []
  }
  if (!raw) return []
  try {
    return migrateStoredEvents(JSON.parse(raw)).events
  } catch {
    return []
  }
}

function writeStoredEvents(payload: StoredSearchEvents) {
  const store = storage()
  if (!store) return
  try {
    store.setItem(SEARCH_EVENTS_STORAGE_KEY, JSON.stringify(payload))
  } catch {
    // Storage full/unavailable — analytics are best-effort by design.
  }
}

/**
 * Append events to the ring buffer. Invalid events are dropped silently;
 * when more than `MAX_STORED_EVENTS` are stored the oldest are evicted.
 */
export function appendSearchEvents(events: SearchEvent[]): number {
  const valid = events.filter((event) => validateSearchEvent(event))
  if (valid.length === 0) return 0
  const current = readStoredEvents()
  const merged = [...current, ...valid].slice(-MAX_STORED_EVENTS)
  writeStoredEvents({ version: SEARCH_EVENTS_SCHEMA_VERSION, events: merged })
  // Queue for flush listeners — delivery is best-effort and independent of
  // whether the storage write succeeded (private mode still gets flushed).
  // Skipped entirely without storage (SSR): there is nothing to flush from.
  if (storage() !== null) {
    pendingFlush.push(...valid)
    // Bound the queue the same way the ring buffer is bounded.
    if (pendingFlush.length > MAX_STORED_EVENTS) {
      pendingFlush = pendingFlush.slice(-MAX_STORED_EVENTS)
    }
  }
  return valid.length
}

export function appendSearchEvent(event: SearchEvent): boolean {
  return appendSearchEvents([event]) > 0
}

/** Remove all stored search-insight events (privacy control). */
export function clearSearchEvents() {
  const store = storage()
  try {
    store?.removeItem(SEARCH_EVENTS_STORAGE_KEY)
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// Batch flush helpers
// ---------------------------------------------------------------------------

const flushListeners = new Set<FlushListener>()
/** Events appended since the last flush — drained by `flushEvents`. */
let pendingFlush: SearchEvent[] = []

/**
 * Subscribe to flush notifications. Listeners receive the batch of events
 * being flushed; they must not mutate the array.
 */
export function onFlush(listener: FlushListener): () => void {
  flushListeners.add(listener)
  return () => flushListeners.delete(listener)
}

/**
 * Flush pending (not-yet-notified) events to all listeners. Returns the
 * number of events flushed. Events already persisted to localStorage are
 * re-notified only if they were appended through `appendSearchEvents`
 * since the last flush — this is a delivery queue, not a storage cursor.
 */
export function flushEvents(): number {
  if (pendingFlush.length === 0) return 0
  const batch = pendingFlush
  pendingFlush = []
  for (const listener of flushListeners) {
    try {
      listener(batch)
    } catch {
      // A failing transport must not break analytics recording.
    }
  }
  return batch.length
}

/**
 * Append events and immediately notify flush listeners — the one-shot
 * drain used by tests and by transports that prefer push over pull.
 */
export function appendAndQueueEvents(events: SearchEvent[]): number {
  const written = appendSearchEvents(events)
  if (written > 0) flushEvents()
  return written
}

/** Test hook: drain pending flush queue without notifying. */
export function resetFlushQueueForTests() {
  pendingFlush = []
  flushListeners.clear()
}
