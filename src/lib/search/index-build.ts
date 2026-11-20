import type { SearchItem } from "./index"

/**
 * Index-build helpers: memoized tokenization, prepared (pre-lowercased)
 * item fields, incremental/chunked building, and search timing
 * instrumentation.
 *
 * `SearchIndex` uses these to avoid re-lowercasing large keyword blobs (docs
 * entries carry up to 800 chars of body text) on every keystroke, and to
 * build the prepared layer lazily/incrementally instead of blocking the main
 * thread when the index first loads.
 */

/** Split text into lowercase word tokens (memoization-friendly pure function). */
export function tokenizeWords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9+#.-]+/)
    .map((token) => token.trim())
    .filter(Boolean)
}

/**
 * Bounded LRU memoizer for `tokenizeWords`. Tokenizing the same strings
 * repeatedly (query log vocabulary, suggestion candidates, prepared index
 * fields) is the hot path this cache removes.
 */
export function createTokenCache(limit = 1000): (text: string) => string[] {
  const cache = new Map<string, string[]>()
  return (text: string): string[] => {
    const hit = cache.get(text)
    if (hit) {
      cache.delete(text)
      cache.set(text, hit)
      return hit
    }
    const tokens = tokenizeWords(text)
    cache.set(text, tokens)
    while (cache.size > limit) {
      const oldest = cache.keys().next().value
      if (oldest === undefined) break
      cache.delete(oldest)
    }
    return tokens
  }
}

/** Shared token cache for index-time and query-time tokenization. */
export const sharedTokenCache = createTokenCache()

/**
 * A search item with its match fields pre-lowercased once at index-build
 * time. Scoring against these avoids a `toLowerCase()` allocation per field
 * per query — significant for docs items whose keywords embed hundreds of
 * characters of body text.
 */
export type PreparedItem = {
  item: SearchItem
  title: string
  subtitle: string
  keywords: string
}

/** Pre-lowercase an item's match fields. Cheap; run once per item. */
export function prepareItem(item: SearchItem): PreparedItem {
  return {
    item,
    title: item.title.toLowerCase(),
    subtitle: (item.subtitle ?? "").toLowerCase(),
    keywords: (item.keywords ?? "").toLowerCase(),
  }
}

/**
 * Build the prepared layer for `items` synchronously. Returns the prepared
 * array in the same order as the input.
 */
export function prepareItems(items: SearchItem[]): PreparedItem[] {
  return items.map(prepareItem)
}

export type IncrementalBuildOptions = {
  /** Items processed per chunk before yielding to the event loop. Default 250. */
  chunkSize?: number
  /** Called after each chunk with (processed, total). */
  onProgress?: (processed: number, total: number) => void
}

/**
 * Incremental variant of `prepareItems`: processes `chunkSize` items per
 * macrotask so a large index build doesn't monopolize the main thread.
 * Yields the same `PreparedItem[]` as the synchronous path.
 */
export async function prepareItemsIncremental(
  items: SearchItem[],
  options: IncrementalBuildOptions = {},
): Promise<PreparedItem[]> {
  const chunkSize = Math.max(1, options.chunkSize ?? 250)
  const prepared: PreparedItem[] = new Array(items.length)
  for (let start = 0; start < items.length; start += chunkSize) {
    const end = Math.min(items.length, start + chunkSize)
    for (let i = start; i < end; i += 1) {
      prepared[i] = prepareItem(items[i]!)
    }
    options.onProgress?.(end, items.length)
    // Yield between chunks (not after the last one).
    if (end < items.length) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
    }
  }
  return prepared
}

export type SearchTiming = {
  /** The query that was timed (already trimmed). */
  query: string
  /** Number of prepared/raw items scanned. */
  itemCount: number
  /** Wall-clock duration of the search in milliseconds. */
  durationMs: number
  /** Number of synonym-expanded query variants scored. */
  variantCount: number
}

export type TimingSink = (timing: SearchTiming) => void

function nowMs(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now()
}

/**
 * Time a synchronous search function and report the result. Used by
 * `SearchIndex` for its `onSearchTiming` instrumentation hook and by tests
 * as a benchmark-ish probe.
 */
export function timeSearch<T>(
  query: string,
  itemCount: number,
  variantCount: number,
  fn: () => T,
  onTiming?: TimingSink,
): T {
  const start = nowMs()
  try {
    return fn()
  } finally {
    const timing: SearchTiming = {
      query,
      itemCount,
      durationMs: nowMs() - start,
      variantCount,
    }
    onTiming?.(timing)
  }
}

/**
 * Benchmark-ish probe: run `search` over `queries` and return per-query
 * timings plus aggregate stats. Used by index-build tests to assert that
 * prepared scoring is not slower than the naive path.
 */
export function benchmarkSearch(
  queries: string[],
  search: (query: string) => unknown,
  itemCount: number,
): { timings: SearchTiming[]; totalMs: number; meanMs: number } {
  const timings: SearchTiming[] = []
  const startAll = nowMs()
  for (const query of queries) {
    timeSearch(
      query,
      itemCount,
      1,
      () => search(query),
      (timing) => timings.push(timing),
    )
  }
  const totalMs = nowMs() - startAll
  return { timings, totalMs, meanMs: queries.length > 0 ? totalMs / queries.length : 0 }
}
