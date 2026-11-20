"use client"

import { useEffect, useMemo, useRef, useState } from "react"

import { SearchIndex, type SearchHit, type SearchIndexProvider, type SearchOptions } from "./index"
import { applySearchFilters, hasActiveFilters, type SearchFilters } from "./filters"
import { computeSearchFacets, type SearchFacets } from "./facets"
import { rankingKey, resolveRanking, type RankingConfig } from "./ranking"
import { SearchResultCache, hitsToCacheEntries, hydrateCachedHits, searchCacheKey } from "./cache"
import { recordSearchQuery, searchSuggestions, type SearchSuggestions } from "./suggestions"

const DEFAULT_DEBOUNCE_MS = 100
/** Delay before idle-time preloading when the menu has never been opened. */
const IDLE_PRELOAD_MS = 1500
/** Minimum query length recorded into the local trending/related log. */
const MIN_TRACKED_QUERY_LENGTH = 2

/** Shared default result cache — one per tab, shared across hook instances. */
export const defaultSearchResultCache = new SearchResultCache()

export type UseSearchIndexOptions = {
  providers: SearchIndexProvider[]
  /** Raw input value; results are computed for the debounced version. */
  query: string
  /** When true (menu open), providers load immediately instead of idling. */
  enabled: boolean
  debounceMs?: number
  /** Result filters (type / section / tag / updated range). */
  filters?: SearchFilters
  /** Ranking weight overrides merged over the index defaults. */
  ranking?: Partial<RankingConfig>
  /**
   * Result cache. Defaults to the shared `defaultSearchResultCache`;
   * pass `null` to disable caching, or your own `SearchResultCache`.
   */
  cache?: SearchResultCache | null
  /** Record debounced queries into the local trending/related log. Default true. */
  trackQueries?: boolean
}

export type UseSearchIndexResult = {
  /** Scored hits for the debounced query, best first, filters applied. */
  results: SearchHit[]
  /**
   * Ranked hits before `filters` — the population facet counts are computed
   * over, so every facet dimension stays explorable while filters are active.
   */
  unfilteredResults: SearchHit[]
  /** Facet counts (type / section / tag) over `unfilteredResults`. */
  facets: SearchFacets
  /** "Did you mean" / related / trending suggestions for the debounced query. */
  suggestions: SearchSuggestions
  /** The query `results` actually corresponds to. */
  debouncedQuery: string
  /** True while providers are still loading their items. */
  loading: boolean
  /** Synchronous search against whatever is loaded — for Enter-key handling. */
  searchNow: (query: string) => SearchHit[]
}

/**
 * React binding for `SearchIndex`: lazily loads providers on first open (or
 * after an idle delay), debounces the query, caches ranked results (in-memory
 * LRU + sessionStorage, invalidated by index version), applies filters, and
 * exposes facets + suggestions. The index instance is stable across renders;
 * provider changes are pushed via `setProviders` and picked up on the next
 * load.
 */
export function useSearchIndex({
  providers,
  query,
  enabled,
  debounceMs = DEFAULT_DEBOUNCE_MS,
  filters,
  ranking,
  cache,
  trackQueries = true,
}: UseSearchIndexOptions): UseSearchIndexResult {
  const indexRef = useRef<SearchIndex | null>(null)
  if (indexRef.current === null) {
    indexRef.current = new SearchIndex(providers)
  }
  const index = indexRef.current

  const resultCache = cache === undefined ? defaultSearchResultCache : cache

  const [version, setVersion] = useState(0)
  const [debouncedQuery, setDebouncedQuery] = useState(query)
  const wasLoadedRef = useRef(false)
  const lastTrackedQueryRef = useRef("")
  /** Signature of the provider set the index last reloaded for. */
  const providersSignatureRef = useRef("")

  // Debounce the query so fuzzy scoring doesn't run on every keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), debounceMs)
    return () => clearTimeout(timer)
  }, [query, debounceMs])

  // Keep the index's provider list in sync; reload when providers *semantically*
  // change after the first load (e.g. the workspace list changed the actions
  // provider key). The signature guard matters: callers often pass a fresh
  // array literal each render, and an unguarded ensureLoaded→setVersion cycle
  // would loop forever.
  useEffect(() => {
    index.setProviders(providers)
    const signature = providers.map((p) => `${p.id}::${p.cacheKey ?? ""}`).join("|")
    const changed = signature !== providersSignatureRef.current
    providersSignatureRef.current = signature
    if (!wasLoadedRef.current || !changed) return
    let cancelled = false
    index.ensureLoaded().then(() => {
      if (!cancelled) setVersion((v) => v + 1)
    })
    return () => {
      cancelled = true
    }
    // index is stable across renders (held in a ref); the signature check
    // inside keeps provider-identity churn from retriggering loads.
  }, [providers])

  // Load providers: immediately when the menu opens, otherwise at idle time.
  // After loading, kick off the incremental prepared-index build so the first
  // real query doesn't pay the lowercasing cost synchronously.
  useEffect(() => {
    let cancelled = false
    const bump = () => {
      if (!cancelled) setVersion((v) => v + 1)
    }
    const afterLoad = () => {
      wasLoadedRef.current = true
      // Large indexes get the chunked prepared build; small ones prepare
      // synchronously on first search anyway (and stay fake-timer friendly).
      if (index.getItems().length > 100) void index.prepareIncremental()
      bump()
    }

    if (enabled) {
      index.ensureLoaded().then(afterLoad)
      return () => {
        cancelled = true
      }
    }

    const timer = setTimeout(() => {
      index.ensureLoaded().then(afterLoad)
    }, IDLE_PRELOAD_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
    // index is stable across renders (held in a ref).
  }, [enabled])

  // Record executed queries for trending/related suggestions (local log only).
  useEffect(() => {
    if (!trackQueries) return
    const q = debouncedQuery.trim()
    if (q.length < MIN_TRACKED_QUERY_LENGTH || q === lastTrackedQueryRef.current) return
    lastTrackedQueryRef.current = q
    recordSearchQuery(q)
  }, [debouncedQuery, trackQueries])

  const effectiveRanking = useMemo(
    () => resolveRanking({ ...index.ranking, ...ranking }),
    // index.ranking is stable for the index's lifetime.
    [index, ranking],
  )
  const rankKey = rankingKey(effectiveRanking)

  const searchOptions = useMemo<SearchOptions>(
    () => ({ ranking: effectiveRanking }),
    [effectiveRanking],
  )

  // Ranked hits for the debounced query — served from the result cache when
  // possible. Cache keys embed instance id + index version + query + ranking,
  // so provider reloads and weight changes invalidate automatically.
  const unfilteredResults = useMemo(() => {
    if (!resultCache) {
      return index.search(debouncedQuery, Date.now(), searchOptions)
    }
    const key = searchCacheKey([index.instanceId, index.version, debouncedQuery, rankKey])
    const cached = resultCache.get(key, index.version)
    if (cached) {
      return hydrateCachedHits(cached, index.getItems())
    }
    const hits = index.search(debouncedQuery, Date.now(), searchOptions)
    resultCache.set(key, index.version, hitsToCacheEntries(hits))
    return hits
    // version re-runs the memo once async provider loads land.
  }, [index, debouncedQuery, version, rankKey, resultCache, searchOptions])

  const results = useMemo(
    () =>
      hasActiveFilters(filters)
        ? applySearchFilters(unfilteredResults, filters ?? {})
        : unfilteredResults,
    [unfilteredResults, filters],
  )

  const facets = useMemo(
    () => computeSearchFacets(unfilteredResults.map((hit) => hit.item)),
    [unfilteredResults],
  )

  const suggestions = useMemo(
    () => searchSuggestions(debouncedQuery, { items: index.getItems() }),
    // version re-derives suggestions once items load.
    [index, debouncedQuery, version],
  )

  const searchNow = useMemo(
    () => (q: string) => {
      const hits = index.search(q, Date.now(), searchOptions)
      return hasActiveFilters(filters) ? applySearchFilters(hits, filters ?? {}) : hits
    },
    [index, searchOptions, filters],
  )

  return {
    results,
    unfilteredResults,
    facets,
    suggestions,
    debouncedQuery,
    loading: !index.isLoaded,
    searchNow,
  }
}
