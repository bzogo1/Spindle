import type { SearchHit, SearchItem } from "./index"

/**
 * Query-result cache for `SearchIndex` / `useSearchIndex` (task: result
 * caching).
 *
 * Two tiers:
 * - an in-memory LRU `Map` (fast path, survives across hook instances), and
 * - optional `sessionStorage` persistence so a palette reopened in the same
 * tab skips recomputation entirely.
 *
 * Entries store only `{ id, score }` pairs — `SearchItem.icon` is a ReactNode
 * and cannot be serialized — and are rehydrated against the live index on
 * read, so icons and any provider-side enrichment are always fresh.
 *
 * Cache keys embed the index `version`; when providers reload and the version
 * bumps, every stale key simply stops matching (and is evicted by the LRU).
 */

export type CachedHitEntry = {
  id: string
  score: number
}

type PersistedEntry = {
  /** Index version the entries were computed against. */
  v: number
  e: CachedHitEntry[]
}

export type SearchResultCacheOptions = {
  /** Max entries kept in memory (and mirrored to sessionStorage). Default 100. */
  maxEntries?: number
  /** sessionStorage key. Default "spindle-search-result-cache". */
  storageKey?: string
  /** Disable sessionStorage persistence (memory-only). Default true. */
  persist?: boolean
}

const DEFAULT_MAX_ENTRIES = 100
const DEFAULT_STORAGE_KEY = "spindle-search-result-cache"

function sessionStore(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage
  } catch {
    return null
  }
}

export class SearchResultCache {
  private readonly maxEntries: number
  private readonly storageKey: string
  private readonly persist: boolean
  /** LRU: Map iteration order is insertion order; get() re-inserts to refresh. */
  private memory = new Map<string, PersistedEntry>()
  private persisted: Map<string, PersistedEntry> | null = null
  private persistLoaded = false

  constructor(options: SearchResultCacheOptions = {}) {
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES
    this.storageKey = options.storageKey ?? DEFAULT_STORAGE_KEY
    this.persist = options.persist ?? true
  }

  private loadPersisted(): Map<string, PersistedEntry> {
    if (this.persistLoaded) return this.persisted ?? new Map()
    this.persistLoaded = true
    this.persisted = new Map()
    const store = sessionStore()
    if (!store || !this.persist) return this.persisted
    try {
      const raw = store.getItem(this.storageKey)
      const parsed = raw ? (JSON.parse(raw) as Record<string, PersistedEntry>) : null
      if (parsed && typeof parsed === "object") {
        for (const [key, value] of Object.entries(parsed)) {
          if (value && Array.isArray(value.e) && typeof value.v === "number") {
            this.persisted.set(key, { v: value.v, e: value.e })
          }
        }
      }
    } catch {
      this.persisted = new Map()
    }
    return this.persisted
  }

  private savePersisted() {
    if (!this.persist) return
    const store = sessionStore()
    if (!store) return
    try {
      const data = Object.fromEntries(this.loadPersisted())
      store.setItem(this.storageKey, JSON.stringify(data))
    } catch {
      // Storage full/unavailable — memory cache still works.
    }
  }

  /**
   * Look up cached `{id, score}` entries for `key` computed at `version`.
   * Returns null on miss or version mismatch (index changed → invalidate).
   */
  get(key: string, version: number): CachedHitEntry[] | null {
    const memory = this.memory.get(key)
    if (memory && memory.v === version) {
      // Refresh LRU position.
      this.memory.delete(key)
      this.memory.set(key, memory)
      return memory.e
    }
    if (memory) this.memory.delete(key) // stale version — drop

    const persisted = this.loadPersisted().get(key)
    if (persisted && persisted.v === version) {
      // Promote into memory.
      this.setMemory(key, persisted)
      return persisted.e
    }
    return null
  }

  /** Store results for `key` at `version`, evicting the oldest entries. */
  set(key: string, version: number, entries: CachedHitEntry[]) {
    const entry: PersistedEntry = { v: version, e: entries }
    this.setMemory(key, entry)
    if (!this.persist) return

    const persisted = this.loadPersisted()
    persisted.delete(key)
    persisted.set(key, entry)
    while (persisted.size > this.maxEntries) {
      const oldest = persisted.keys().next().value
      if (oldest === undefined) break
      persisted.delete(oldest)
    }
    this.savePersisted()
  }

  private setMemory(key: string, entry: PersistedEntry) {
    this.memory.delete(key)
    this.memory.set(key, entry)
    while (this.memory.size > this.maxEntries) {
      const oldest = this.memory.keys().next().value
      if (oldest === undefined) break
      this.memory.delete(oldest)
    }
  }

  /** Number of live memory entries (diagnostics/tests). */
  get size(): number {
    return this.memory.size
  }

  clear() {
    this.memory.clear()
    this.persisted?.clear()
    const store = sessionStore()
    try {
      store?.removeItem(this.storageKey)
    } catch {
      // ignore
    }
  }
}

/**
 * Build a stable cache key from arbitrary parts (index version, query,
 * ranking key, filters key). `undefined`/empty parts collapse so equivalent
 * configs share entries.
 */
export function searchCacheKey(parts: ReadonlyArray<string | number | undefined>): string {
  return parts.map((part) => (part === undefined || part === "" ? "-" : String(part))).join("")
}

/** Strip a hit list down to the serializable `{id, score}` pairs. */
export function hitsToCacheEntries(hits: SearchHit[]): CachedHitEntry[] {
  return hits.map((hit) => ({ id: hit.item.id, score: hit.score }))
}

/**
 * Rehydrate cached entries against the live item list. Entries whose item
 * no longer exists in the index are dropped; order and scores are preserved.
 */
export function hydrateCachedHits(entries: CachedHitEntry[], items: SearchItem[]): SearchHit[] {
  const byId = new Map(items.map((item) => [item.id, item]))
  const hits: SearchHit[] = []
  for (const entry of entries) {
    const item = byId.get(entry.id)
    if (item) hits.push({ item, score: entry.score })
  }
  return hits
}
