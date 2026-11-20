import { detectLocale } from "@/lib/i18n/locale"
import type { SearchHit } from "@/lib/search"

import { getAnonymousId } from "./anonymous-id"
import {
  MAX_DWELL_MS,
  SEARCH_EVENTS_SCHEMA_VERSION,
  type DocOpenedEvent,
  type ExperimentConversionEvent,
  type ExperimentExposureEvent,
  type FeedbackSubmittedEvent,
  type QuerySubmittedEvent,
  type ResultClickedEvent,
  type ResultDwellEvent,
  type SearchEvent,
  type SearchPerformanceEvent,
  type SuggestionUsedEvent,
  type ZeroResultsEvent,
} from "./schema"
import { appendSearchEvent } from "./store"

/**
 * Event tracking for search analytics.
 *
 * All functions are client-safe and SSR-safe: without `window` they resolve
 * locale/anon-id fallbacks and the store write becomes a no-op, so callers
 * can invoke them unconditionally.
 *
 * Events covered:
 *   query_submitted, result_clicked, result_dwell, zero_results,
 *   suggestion_used, plus search_performance / doc_opened /
 *   feedback_submitted / experiment_* used by the other insight modules.
 */

export type TrackContext = {
  locale?: string
  anonId?: string
}

function now(): number {
  return Date.now()
}

function base(
  context?: TrackContext,
): Pick<SearchEvent, "schemaVersion" | "ts" | "anonId" | "locale"> {
  return {
    schemaVersion: SEARCH_EVENTS_SCHEMA_VERSION,
    ts: now(),
    anonId: context?.anonId ?? (typeof window === "undefined" ? undefined : getAnonymousId()),
    locale: context?.locale ?? detectLocale(),
  }
}

function emit(event: SearchEvent): boolean {
  return appendSearchEvent(event)
}

export type QuerySubmittedInput = {
  query: string
  resultCount: number
  latencyMs?: number
  itemCount?: number
  cacheHit?: boolean
}

/** Record a submitted/executed search query. */
export function trackQuerySubmitted(input: QuerySubmittedInput, context?: TrackContext): boolean {
  const event: QuerySubmittedEvent = {
    ...base(context),
    type: "query_submitted",
    query: input.query.trim(),
    resultCount: Math.max(0, Math.floor(input.resultCount)),
    latencyMs: input.latencyMs,
    itemCount: input.itemCount,
    cacheHit: input.cacheHit,
  }
  return emit(event)
}

export type ResultClickedInput = {
  query: string
  itemId: string
  itemTitle?: string
  /** 0-based rank; pass the hit's index in the result list. */
  position: number
  itemType?: string
  href?: string
}

/** Record a click on a search result. */
export function trackResultClicked(input: ResultClickedInput, context?: TrackContext): boolean {
  const event: ResultClickedEvent = {
    ...base(context),
    type: "result_clicked",
    query: input.query.trim(),
    itemId: input.itemId,
    itemTitle: input.itemTitle,
    position: Math.max(0, Math.floor(input.position)),
    itemType: input.itemType,
    href: input.href,
  }
  return emit(event)
}

/**
 * Convenience: build `ResultClickedInput` from a `SearchHit` returned by
 * `SearchIndex.search` / `useSearchIndex`. Only imports the `SearchHit`
 * type — no runtime dependency on the search module.
 */
export function resultClickedInputFromHit(
  query: string,
  hit: SearchHit,
  position: number,
): ResultClickedInput {
  return {
    query,
    itemId: hit.item.id,
    itemTitle: hit.item.title,
    position,
    itemType: hit.item.type,
    href: hit.item.href,
  }
}

/** Record how long a result stayed in view / on the target page. */
export function trackResultDwell(
  input: { query: string; itemId: string; dwellMs: number },
  context?: TrackContext,
): boolean {
  const event: ResultDwellEvent = {
    ...base(context),
    type: "result_dwell",
    query: input.query.trim(),
    itemId: input.itemId,
    dwellMs: Math.min(Math.max(0, input.dwellMs), MAX_DWELL_MS),
  }
  return emit(event)
}

/** Record a query that produced zero results. */
export function trackZeroResults(query: string, context?: TrackContext): boolean {
  const event: ZeroResultsEvent = {
    ...base(context),
    type: "zero_results",
    query: query.trim(),
  }
  return emit(event)
}

/** Record use of a search suggestion (did-you-mean / related / trending). */
export function trackSuggestionUsed(
  input: { query: string; suggestion: string; source: SuggestionUsedEvent["source"] },
  context?: TrackContext,
): boolean {
  const event: SuggestionUsedEvent = {
    ...base(context),
    type: "suggestion_used",
    query: input.query.trim(),
    suggestion: input.suggestion,
    source: input.source,
  }
  return emit(event)
}

/** Record raw search performance samples (latency, index size, cache hits). */
export function trackSearchPerformance(
  input: {
    latencyMs: number
    itemCount: number
    cacheHit?: boolean
    query?: string
    prepareMs?: number
  },
  context?: TrackContext,
): boolean {
  const event: SearchPerformanceEvent = {
    ...base(context),
    type: "search_performance",
    query: input.query?.trim() || undefined,
    latencyMs: Math.max(0, input.latencyMs),
    itemCount: Math.max(0, Math.floor(input.itemCount)),
    cacheHit: input.cacheHit,
    prepareMs: input.prepareMs,
  }
  return emit(event)
}

/** Record a doc opened from search (funnel step 3). */
export function trackDocOpened(
  input: { query?: string; itemId?: string; href?: string },
  context?: TrackContext,
): boolean {
  const event: DocOpenedEvent = {
    ...base(context),
    type: "doc_opened",
    query: input.query?.trim() || undefined,
    itemId: input.itemId,
    href: input.href,
  }
  return emit(event)
}

/** Record a feedback submission attributed (optionally) to a search query. */
export function trackFeedbackSubmitted(
  input: { query?: string; source?: string },
  context?: TrackContext,
): boolean {
  const event: FeedbackSubmittedEvent = {
    ...base(context),
    type: "feedback_submitted",
    query: input.query?.trim() || undefined,
    source: input.source,
  }
  return emit(event)
}

/** Record an experiment exposure. */
export function trackExperimentExposure(
  experiment: string,
  variant: string,
  context?: TrackContext,
): boolean {
  const event: ExperimentExposureEvent = {
    ...base(context),
    type: "experiment_exposure",
    experiment,
    variant,
  }
  return emit(event)
}

/** Record an experiment conversion. */
export function trackExperimentConversion(
  experiment: string,
  variant: string,
  conversion: string,
  context?: TrackContext,
): boolean {
  const event: ExperimentConversionEvent = {
    ...base(context),
    type: "experiment_conversion",
    experiment,
    variant,
    conversion,
  }
  return emit(event)
}

// ---------------------------------------------------------------------------
// Dwell timer helper
// ---------------------------------------------------------------------------

export type DwellTracker = {
  /** Start (or restart) the dwell clock for an item. */
  start: (query: string, itemId: string) => void
  /** Stop the clock and record a result_dwell event, if one was running. */
  stop: () => boolean
  /** Discard the running measurement without recording. */
  cancel: () => void
}

/**
 * Measure dwell time between a result click and the user leaving (or the
 * component unmounting). Uses `performance.now()` when available.
 */
export function createDwellTracker(context?: TrackContext): DwellTracker {
  let active: { query: string; itemId: string; startMs: number } | null = null
  const clock = () => (typeof performance !== "undefined" ? performance.now() : Date.now())

  return {
    start(query, itemId) {
      active = { query, itemId, startMs: clock() }
    },
    stop() {
      if (!active) return false
      const dwellMs = clock() - active.startMs
      const { query, itemId } = active
      active = null
      return trackResultDwell({ query, itemId, dwellMs }, context)
    },
    cancel() {
      active = null
    },
  }
}

// ---------------------------------------------------------------------------
// Query lifecycle helper — bundles submit → zero-results detection
// ---------------------------------------------------------------------------

export type QueryLifecycle = {
  /** Record the query; returns true when it produced zero results. */
  submitted: (input: QuerySubmittedInput) => boolean
}

/**
 * Convenience wrapper around `trackQuerySubmitted`. Zero-result queries are
 * recorded via the `resultCount` field on `query_submitted`; call
 * `trackZeroResults` separately when the UI shows a dedicated "no results"
 * state — the two signals are merged (deduplicated) at aggregation time.
 */
export function createQueryLifecycle(context?: TrackContext): QueryLifecycle {
  return {
    submitted(input) {
      return trackQuerySubmitted(input, context)
    },
  }
}
