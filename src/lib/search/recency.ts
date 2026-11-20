/**
 * Frecency (frequency + recency) tracking for command-menu items, persisted to
 * localStorage so recently/frequently opened results surface first.
 *
 * The store maps item id → `{ count, lastUsed }`. The on-disk shape changed
 * once from a plain `string[]`; old entries are migrated on read.
 */

export type RecencyEntry = {
  /** How many times the item was activated. */
  count: number
  /** Epoch milliseconds of the last activation. */
  lastUsed: number
}

export const RECENTS_STORAGE_KEY = "spindle-command-recents"
/** Entries kept for scoring; only the top few are shown in the Recent group. */
const MAX_ENTRIES = 100
/** Recency half-life: a use one week old counts half as much as a fresh one. */
const HALF_LIFE_MS = 7 * 24 * 60 * 60 * 1000
/** Score units subtracted from a fuzzy score at maximum frecency. */
export const RECENCY_BOOST = 150
/** Cap on the frequency component so one viral item can't dominate forever. */
const MAX_COUNT = 10

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage
  } catch {
    return null
  }
}

function isRecencyEntry(value: unknown): value is RecencyEntry {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as RecencyEntry).count === "number" &&
    typeof (value as RecencyEntry).lastUsed === "number"
  )
}

/** Read the full recency map, migrating the legacy `string[]` shape. */
export function readRecencyMap(now: number = Date.now()): Map<string, RecencyEntry> {
  const map = new Map<string, RecencyEntry>()
  const store = storage()
  if (!store) return map

  let parsed: unknown
  try {
    const raw = store.getItem(RECENTS_STORAGE_KEY)
    parsed = raw ? JSON.parse(raw) : null
  } catch {
    return map
  }

  if (Array.isArray(parsed)) {
    // Legacy format: ordered id list, most recent first.
    parsed.forEach((id, index) => {
      if (typeof id === "string") {
        map.set(id, { count: 1, lastUsed: now - index * 1000 })
      }
    })
    return map
  }

  if (typeof parsed === "object" && parsed !== null) {
    for (const [id, entry] of Object.entries(parsed as Record<string, unknown>)) {
      if (isRecencyEntry(entry)) map.set(id, entry)
    }
  }
  return map
}

function writeRecencyMap(map: Map<string, RecencyEntry>) {
  const store = storage()
  if (!store) return
  const entries = [...map.entries()]
    .sort((a, b) => b[1].lastUsed - a[1].lastUsed)
    .slice(0, MAX_ENTRIES)
  try {
    store.setItem(RECENTS_STORAGE_KEY, JSON.stringify(Object.fromEntries(entries)))
  } catch {
    // Storage can be unavailable (private mode); recents just won't persist.
  }
}

/** Record an activation of `id`, bumping its count and timestamp. */
export function recordUse(id: string, now: number = Date.now()) {
  const map = readRecencyMap(now)
  const entry = map.get(id)
  map.set(id, { count: (entry?.count ?? 0) + 1, lastUsed: now })
  writeRecencyMap(map)
}

/**
 * Frecency in `[0, 1]`: half frequency (capped count) and half exponential
 * recency decay. Items never used score 0.
 */
export function frecency(id: string, now: number = Date.now()): number {
  return frecencyFromEntry(readRecencyMap(now).get(id), now)
}

/** Frecency for a single entry — lets callers score many items against one map read. */
export function frecencyFromEntry(entry: RecencyEntry | undefined, now: number): number {
  if (!entry) return 0
  const frequency = Math.min(entry.count, MAX_COUNT) / MAX_COUNT
  const age = Math.max(0, now - entry.lastUsed)
  const recency = Math.exp((-age / HALF_LIFE_MS) * Math.LN2)
  return frequency * 0.5 + recency * 0.5
}

/** Frecency lookup against a pre-read recency map (avoids N storage reads per search). */
export function frecencyFromMap(map: Map<string, RecencyEntry>, id: string, now: number): number {
  return frecencyFromEntry(map.get(id), now)
}

/** Ids ordered by frecency (best first) — drives the Recent group. */
export function recentIds(limit: number, now: number = Date.now()): string[] {
  const map = readRecencyMap(now)
  return [...map.entries()]
    .sort((a, b) => {
      const fa =
        a[1].count * 0.5 + Math.exp((-(now - a[1].lastUsed) / HALF_LIFE_MS) * Math.LN2) * 0.5
      const fb =
        b[1].count * 0.5 + Math.exp((-(now - b[1].lastUsed) / HALF_LIFE_MS) * Math.LN2) * 0.5
      return fb - fa || b[1].lastUsed - a[1].lastUsed
    })
    .slice(0, limit)
    .map(([id]) => id)
}
