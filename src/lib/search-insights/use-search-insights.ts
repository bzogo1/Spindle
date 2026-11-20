"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { useLanguage } from "@/components/i18n/language-provider"
import { detectLocale, LOCALE_CHANGE_EVENT, type Locale } from "@/lib/i18n/locale"
import type { SearchHit } from "@/lib/search"
import {
  useSearchIndex,
  type UseSearchIndexOptions,
  type UseSearchIndexResult,
} from "@/lib/search/use-search-index"

import { getAnonymousId } from "./anonymous-id"
import {
  resultClickedInputFromHit,
  trackQuerySubmitted,
  trackResultClicked,
  trackSearchPerformance,
  trackSuggestionUsed,
  trackZeroResults,
} from "./tracker"

/**
 * Locale-aware, analytics-instrumented wrapper around `useSearchIndex`
 * (tasks 37/47/50 glue).
 *
 * - Resolves the active locale via `useLanguage()` when a
 *   `LanguageProvider` is mounted, falling back to `detectLocale()` +
 *   `LOCALE_CHANGE_EVENT` otherwise — every tracked event carries it, and
 *   per-language stats are computed in `analytics.ts`.
 * - Records `query_submitted` once per settled debounced query (with
 *   result count and an approximate latency measured from debounce to
 *   results), `zero_results` for empty result sets, `result_clicked` via
 *   `trackClick`, and `search_performance` samples.
 *
 * Tracking degrades to no-ops when `window`/storage is unavailable
 * (SSR, private mode).
 */

export type UseTrackedSearchOptions = UseSearchIndexOptions & {
  /** Disable automatic query/performance tracking. Default true. */
  trackAnalytics?: boolean
}

export type UseTrackedSearchResult = UseSearchIndexResult & {
  /** Active locale used for all tracked events. */
  locale: Locale
  /** Record a click on `hit` at `position` for the current query. */
  trackClick: (hit: SearchHit, position: number) => boolean
  /** Record use of a suggestion for the current query. */
  trackSuggestion: (suggestion: string, source: "didYouMean" | "related" | "trending") => boolean
  /** Record an explicit zero-results state for the current query. */
  trackNoResults: () => boolean
}

/**
 * Probe for the i18n context. `useLanguage` throws outside a
 * `LanguageProvider`; returning null lets the caller fall back to
 * `detectLocale()` + change events. The hook call itself is unconditional,
 * so hook order stays stable.
 */
function useOptionalProviderLocale(): Locale | null {
  try {
    // Intentional optional-context probe; the call is unconditional so hook
    // order stays stable (no react-hooks plugin is configured for this file).
    const language = useLanguage()
    return language.locale
  } catch {
    return null
  }
}

function useSearchLocale(): Locale {
  const providerLocale = useOptionalProviderLocale()
  const [detected, setDetected] = useState<Locale>(() => detectLocale())

  useEffect(() => {
    if (providerLocale) return
    const onChange = () => setDetected(detectLocale())
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === "spindle_locale") onChange()
    }
    window.addEventListener(LOCALE_CHANGE_EVENT, onChange)
    window.addEventListener("storage", onStorage)
    return () => {
      window.removeEventListener(LOCALE_CHANGE_EVENT, onChange)
      window.removeEventListener("storage", onStorage)
    }
  }, [providerLocale])

  return providerLocale ?? detected
}

export function useTrackedSearch({
  trackAnalytics = true,
  ...options
}: UseTrackedSearchOptions): UseTrackedSearchResult {
  const locale = useSearchLocale()
  const search = useSearchIndex(options)

  // Timestamp (performance.now) of the last debounced-query change — the
  // start of the latency window we report once results settle.
  const pendingSinceRef = useRef<number | null>(null)
  const lastTrackedQueryRef = useRef("")
  const anonId = useMemo(() => getAnonymousId(), [])

  const clock = () => (typeof performance !== "undefined" ? performance.now() : Date.now())

  useEffect(() => {
    pendingSinceRef.current = clock()
  }, [search.debouncedQuery])

  useEffect(() => {
    if (!trackAnalytics) return
    const query = search.debouncedQuery.trim()
    // Empty query: reset the dedupe ref so re-running the same search later
    // is tracked again instead of being suppressed as a "repeat".
    if (!query) {
      lastTrackedQueryRef.current = ""
      return
    }
    if (search.loading) return
    if (query === lastTrackedQueryRef.current) return
    lastTrackedQueryRef.current = query

    const latencyMs =
      pendingSinceRef.current !== null ? Math.max(0, clock() - pendingSinceRef.current) : undefined
    pendingSinceRef.current = null

    trackQuerySubmitted(
      {
        query,
        resultCount: search.results.length,
        latencyMs,
        itemCount: search.unfilteredResults.length,
      },
      { locale, anonId },
    )
    if (search.results.length === 0) {
      trackZeroResults(query, { locale, anonId })
    }
    trackSearchPerformance(
      {
        query,
        latencyMs: latencyMs ?? 0,
        itemCount: search.unfilteredResults.length,
      },
      { locale, anonId },
    )
    // results/loading/debouncedQuery capture the settled state; locale/anonId
    // are stable per mount.
  }, [search.debouncedQuery, search.results, search.loading, trackAnalytics])

  const trackClick = useCallback(
    (hit: SearchHit, position: number) =>
      trackResultClicked(resultClickedInputFromHit(search.debouncedQuery, hit, position), {
        locale,
        anonId,
      }),
    [search.debouncedQuery, locale, anonId],
  )

  const trackSuggestion = useCallback(
    (suggestion: string, source: "didYouMean" | "related" | "trending") =>
      trackSuggestionUsed({ query: search.debouncedQuery, suggestion, source }, { locale, anonId }),
    [search.debouncedQuery, locale, anonId],
  )

  const trackNoResults = useCallback(
    () => trackZeroResults(search.debouncedQuery, { locale, anonId }),
    [search.debouncedQuery, locale, anonId],
  )

  return {
    ...search,
    locale,
    trackClick,
    trackSuggestion,
    trackNoResults,
  }
}
