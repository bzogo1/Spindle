/**
 * Run result cache keyed by input hash (task 82).
 *
 * Caches serialized `AgentRun` records in `localStorage` (or any injected
 * `Storage`-like object, which keeps tests DOM-free). Cache hits are detected
 * by recomputing the run's input hash — prompt + model + params — so a repeat
 * request can replay the recorded run instead of re-executing.
 */

import { runInputHash } from "./hash"
import type { AgentRun } from "./types"
import { nowIso } from "./types"

const DEFAULT_PREFIX = "agent-run-cache:v1:"

/** Minimal storage contract — satisfied by `localStorage` and test doubles. */
export interface RunCacheStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
  key(index: number): string | null
  readonly length: number
}

export interface CachedRunEntry {
  hash: string
  run: AgentRun
  cachedAt: string
  /** Number of times this entry has been served from cache. */
  hits: number
  /** Monotonic insertion counter — deterministic eviction tiebreak. */
  order: number
}

export interface RunCacheOptions {
  prefix?: string
  /** Max entries kept; oldest evicted first. Default 50. */
  maxEntries?: number
  /** TTL in ms; entries older than this are treated as misses. Default 7d. */
  ttlMs?: number
}

const DEFAULT_MAX_ENTRIES = 50
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000

function defaultStorage(): RunCacheStorage | null {
  if (typeof globalThis === "undefined") return null
  const storage = (globalThis as { localStorage?: RunCacheStorage }).localStorage
  return storage ?? null
}

export class RunCache {
  private readonly storage: RunCacheStorage | null
  private readonly prefix: string
  private readonly maxEntries: number
  private readonly ttlMs: number
  private orderCounter = 0

  constructor(storage?: RunCacheStorage | null, options: RunCacheOptions = {}) {
    this.storage = storage === undefined ? defaultStorage() : storage
    this.prefix = options.prefix ?? DEFAULT_PREFIX
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS
  }

  /** Hash identifying a run request (prompt + model + params). */
  static inputHash(
    run: Pick<AgentRun, "prompt" | "model"> & { params?: Record<string, unknown> },
  ): string {
    return runInputHash(run)
  }

  private keyFor(hash: string): string {
    return `${this.prefix}${hash}`
  }

  private readEntry(key: string): CachedRunEntry | null {
    if (!this.storage) return null
    try {
      const raw = this.storage.getItem(key)
      if (!raw) return null
      const parsed = JSON.parse(raw) as CachedRunEntry
      if (!parsed || typeof parsed.hash !== "string" || !parsed.run) return null
      return parsed
    } catch {
      return null
    }
  }

  private writeEntry(hash: string, entry: CachedRunEntry): void {
    if (!this.storage) return
    try {
      this.storage.setItem(this.keyFor(hash), JSON.stringify(entry))
    } catch {
      // Quota exceeded or storage disabled — caching is best-effort.
    }
  }

  /** Look up a cached run by input hash. Returns null on miss/expiry. */
  get(hash: string): CachedRunEntry | null {
    const entry = this.readEntry(this.keyFor(hash))
    if (!entry) return null
    if (Date.now() - Date.parse(entry.cachedAt) > this.ttlMs) {
      this.delete(hash)
      return null
    }
    return entry
  }

  /** True when a completed run exists for this input hash. */
  has(hash: string): boolean {
    const entry = this.get(hash)
    return entry !== null && entry.run.status === "completed"
  }

  /** Store a run under its input hash, evicting oldest entries past the cap. */
  set(run: AgentRun, params?: Record<string, unknown>): CachedRunEntry {
    const hash = runInputHash({ prompt: run.prompt, model: run.model, params })
    const existing = this.get(hash)
    this.orderCounter += 1
    const entry: CachedRunEntry = {
      hash,
      run,
      cachedAt: nowIso(),
      hits: existing?.hits ?? 0,
      order: this.orderCounter,
    }
    this.writeEntry(hash, entry)
    this.evictOverflow()
    return entry
  }

  /** Convenience: cache only completed runs (failed runs aren't replayable). */
  setIfCacheable(run: AgentRun, params?: Record<string, unknown>): CachedRunEntry | null {
    if (run.status !== "completed") return null
    return this.set(run, params)
  }

  /**
   * Serve a run from cache: increments the hit counter (persisted on the
   * entry and mirrored to `metrics.cacheHits` on the returned run) so callers
   * can distinguish a replay from a fresh execution.
   */
  getForReplay(hash: string): { entry: CachedRunEntry; run: AgentRun } | null {
    const entry = this.get(hash)
    if (!entry) return null
    const hits = entry.hits + 1
    const updated: CachedRunEntry = { ...entry, hits }
    this.writeEntry(hash, updated)
    return {
      entry: updated,
      run: {
        ...entry.run,
        metrics: { ...entry.run.metrics, cacheHits: hits },
      },
    }
  }

  delete(hash: string): boolean {
    if (!this.storage) return false
    const key = this.keyFor(hash)
    if (this.storage.getItem(key) === null) return false
    this.storage.removeItem(key)
    return true
  }

  clear(): void {
    if (!this.storage) return
    const keys: string[] = []
    for (let i = 0; i < this.storage.length; i += 1) {
      const key = this.storage.key(i)
      if (key && key.startsWith(this.prefix)) keys.push(key)
    }
    for (const key of keys) this.storage.removeItem(key)
  }

  /** All cached hashes, newest first. */
  list(): CachedRunEntry[] {
    if (!this.storage) return []
    const entries: CachedRunEntry[] = []
    for (let i = 0; i < this.storage.length; i += 1) {
      const key = this.storage.key(i)
      if (!key || !key.startsWith(this.prefix)) continue
      const entry = this.readEntry(key)
      if (entry) entries.push(entry)
    }
    return entries.sort(
      (a, b) => Date.parse(b.cachedAt) - Date.parse(a.cachedAt) || (b.order ?? 0) - (a.order ?? 0),
    )
  }

  private evictOverflow(): void {
    const entries = this.list()
    for (const stale of entries.slice(this.maxEntries)) {
      this.delete(stale.hash)
    }
  }
}

/** Shared default cache bound to `localStorage` when available. */
export const defaultRunCache = new RunCache()

export interface RunCacheLookup {
  hit: boolean
  hash: string
  entry?: CachedRunEntry
}

/**
 * Cache-hit detection for a prospective run: returns the hash plus the cached
 * entry when one exists. Does not increment hit counters — use
 * `RunCache.getForReplay` when actually replaying.
 */
export function lookupRunCache(
  input: { prompt: string; model: string; params?: Record<string, unknown> },
  cache: RunCache = defaultRunCache,
): RunCacheLookup {
  const hash = runInputHash(input)
  const entry = cache.get(hash)
  return { hit: entry !== null, hash, ...(entry ? { entry } : {}) }
}
