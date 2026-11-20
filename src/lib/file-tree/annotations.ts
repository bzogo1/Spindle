/**
 * localStorage-backed annotation stores for the file tree:
 * bookmarks, recent files and favorites.
 *
 * Each store is a small namespaced string-set persisted under a single JSON
 * key. All stores take an injectable `StorageLike` (defaults to
 * `globalThis.localStorage`) so they work in tests and non-browser envs.
 *
 * Stores are intentionally synchronous and mutation-notifying: subscribe to
 * `change` events to re-render UI (React: `useSyncExternalStore`).
 */

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export function defaultStorage(): StorageLike | null {
  try {
    if (typeof globalThis !== "undefined" && globalThis.localStorage) {
      return globalThis.localStorage
    }
  } catch {
    // Accessing localStorage can throw in sandboxed contexts.
  }
  return null
}

interface Listener {
  (): void
}

class StringSetStore {
  private readonly key: string
  private readonly storage: StorageLike | null
  private readonly maxSize: number
  private values = new Set<string>()
  private readonly listeners = new Set<Listener>()

  constructor(key: string, storage: StorageLike | null, maxSize = Infinity) {
    this.key = key
    this.storage = storage
    this.maxSize = maxSize
    this.load()
  }

  private load() {
    try {
      const raw = this.storage?.getItem(this.key)
      if (!raw) return
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        this.values = new Set(parsed.filter((v): v is string => typeof v === "string"))
      }
    } catch {
      // Corrupt payload — start fresh.
    }
  }

  private persist() {
    try {
      this.storage?.setItem(this.key, JSON.stringify([...this.values]))
    } catch {
      // Quota / privacy mode — keep in-memory state.
    }
  }

  has(id: string): boolean {
    return this.values.has(id)
  }

  list(): string[] {
    return [...this.values]
  }

  /**
   * Add `id` to the set. Set insertion order is append-only, so re-adding an
   * existing id moves it to the END (consumers like RecentFilesStore read
   * back-to-front for most-recent-first ordering). Evicts the oldest
   * (first-inserted) entry when over `maxSize`.
   */
  add(id: string): void {
    if (this.values.has(id)) {
      this.values.delete(id)
    }
    this.values.add(id)
    while (this.values.size > this.maxSize) {
      const oldest = this.values.values().next().value as string | undefined
      if (oldest === undefined) break
      this.values.delete(oldest)
    }
    this.persist()
    this.emit()
  }

  remove(id: string): boolean {
    if (!this.values.delete(id)) return false
    this.persist()
    this.emit()
    return true
  }

  toggle(id: string): boolean {
    return this.has(id) ? this.remove(id) : (this.add(id), true)
  }

  clear(): void {
    if (this.values.size === 0) return
    this.values.clear()
    this.persist()
    this.emit()
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit() {
    for (const listener of this.listeners) listener()
  }
}

// ---- Bookmarks ------------------------------------------------------------

export class BookmarkStore {
  private readonly store: StringSetStore

  constructor(storage: StorageLike | null = defaultStorage(), key = "spindle:tree-bookmarks") {
    this.store = new StringSetStore(key, storage)
  }

  has(id: string) {
    return this.store.has(id)
  }
  ids() {
    return this.store.list()
  }
  add(id: string) {
    this.store.add(id)
  }
  remove(id: string) {
    this.store.remove(id)
  }
  toggle(id: string) {
    return this.store.toggle(id)
  }
  subscribe(listener: () => void) {
    return this.store.subscribe(listener)
  }
}

// ---- Recent files ----------------------------------------------------------

export class RecentFilesStore {
  private readonly store: StringSetStore

  constructor(
    storage: StorageLike | null = defaultStorage(),
    key = "spindle:tree-recents",
    maxSize = 20,
  ) {
    this.store = new StringSetStore(key, storage, maxSize)
  }

  /** Record that `id` was opened; returns the updated most-recent-first list. */
  recordOpen(id: string): string[] {
    this.store.add(id)
    // Newest-first: we appended at the end on add, so reverse for reads.
    return this.store.list().reverse()
  }

  ids(): string[] {
    return this.store.list().reverse()
  }

  has(id: string) {
    return this.store.has(id)
  }

  clear() {
    this.store.clear()
  }

  subscribe(listener: () => void) {
    return this.store.subscribe(listener)
  }
}

// ---- Favorites -------------------------------------------------------------

export class FavoriteStore {
  private readonly store: StringSetStore

  constructor(storage: StorageLike | null = defaultStorage(), key = "spindle:tree-favorites") {
    this.store = new StringSetStore(key, storage)
  }

  has(id: string) {
    return this.store.has(id)
  }
  ids() {
    return this.store.list()
  }
  add(id: string) {
    this.store.add(id)
  }
  remove(id: string) {
    this.store.remove(id)
  }
  toggle(id: string) {
    return this.store.toggle(id)
  }
  subscribe(listener: () => void) {
    return this.store.subscribe(listener)
  }
}

/** In-memory storage for tests / SSR-safe usage. */
export function createMemoryStorage(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, String(v)),
    removeItem: (k) => void data.delete(k),
  }
}
