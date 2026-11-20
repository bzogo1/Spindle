/**
 * Formal event schema for search analytics.
 *
 * Every event the tracker persists is a discriminated union on `type`,
 * carries a `schemaVersion`, a timestamp, and an optional anonymous session
 * id. `validateSearchEvent` is the runtime gate used by the store on read —
 * malformed or future-versioned events are dropped rather than crashing the
 * dashboard.
 */

export const SEARCH_EVENTS_SCHEMA_VERSION = 1

/** Upper bound for dwell measurements — anything longer is clamped. */
export const MAX_DWELL_MS = 10 * 60 * 1000

export type SearchEventBase = {
  /** Schema version this event was written with. */
  schemaVersion: number
  /** Epoch milliseconds. */
  ts: number
  /** Anonymous session/visitor id (localStorage-persisted). */
  anonId?: string
  /** BCP-47-ish locale detected at event time (`en`, `uk`, …). */
  locale?: string
}

export type QuerySubmittedEvent = SearchEventBase & {
  type: "query_submitted"
  query: string
  /** Number of results the query produced. */
  resultCount: number
  /** Wall-clock search latency in ms (performance.now based). */
  latencyMs?: number
  /** Index size at query time — feeds the performance panel. */
  itemCount?: number
  /** True when the result came from the search result cache. */
  cacheHit?: boolean
}

export type ResultClickedEvent = SearchEventBase & {
  type: "result_clicked"
  query: string
  itemId: string
  itemTitle?: string
  /** 0-based rank of the clicked result. */
  position: number
  itemType?: string
  href?: string
}

export type ResultDwellEvent = SearchEventBase & {
  type: "result_dwell"
  query: string
  itemId: string
  dwellMs: number
}

export type ZeroResultsEvent = SearchEventBase & {
  type: "zero_results"
  query: string
}

export type SuggestionUsedEvent = SearchEventBase & {
  type: "suggestion_used"
  query: string
  suggestion: string
  /** Which suggestion surface produced it. */
  source: "didYouMean" | "related" | "trending"
}

export type ExperimentExposureEvent = SearchEventBase & {
  type: "experiment_exposure"
  experiment: string
  variant: string
}

export type ExperimentConversionEvent = SearchEventBase & {
  type: "experiment_conversion"
  experiment: string
  variant: string
  /** What converted, e.g. "result_clicked", "doc_opened". */
  conversion: string
}

export type SearchPerformanceEvent = SearchEventBase & {
  type: "search_performance"
  query?: string
  latencyMs: number
  itemCount: number
  cacheHit?: boolean
  /** Index build/prepare duration when known. */
  prepareMs?: number
}

export type DocOpenedEvent = SearchEventBase & {
  type: "doc_opened"
  query?: string
  itemId?: string
  href?: string
}

export type FeedbackSubmittedEvent = SearchEventBase & {
  type: "feedback_submitted"
  query?: string
  source?: string
}

export type SearchEvent =
  | QuerySubmittedEvent
  | ResultClickedEvent
  | ResultDwellEvent
  | ZeroResultsEvent
  | SuggestionUsedEvent
  | ExperimentExposureEvent
  | ExperimentConversionEvent
  | SearchPerformanceEvent
  | DocOpenedEvent
  | FeedbackSubmittedEvent

export type SearchEventType = SearchEvent["type"]

export const SEARCH_EVENT_TYPES: readonly SearchEventType[] = [
  "query_submitted",
  "result_clicked",
  "result_dwell",
  "zero_results",
  "suggestion_used",
  "experiment_exposure",
  "experiment_conversion",
  "search_performance",
  "doc_opened",
  "feedback_submitted",
] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string"
}

function isOptionalNumber(value: unknown): boolean {
  return value === undefined || isNumber(value)
}

function isOptionalBoolean(value: unknown): boolean {
  return value === undefined || typeof value === "boolean"
}

/**
 * Structural validation for a single event. Intentionally permissive about
 * `schemaVersion` (events from a newer schema are still kept — the store
 * buckets by version for migration) but strict about the fields analytics
 * actually reads.
 */
export function validateSearchEvent(value: unknown): value is SearchEvent {
  if (!isRecord(value)) return false
  if (!isNumber(value.schemaVersion) || !isNumber(value.ts)) return false
  if (!isOptionalString(value.anonId) || !isOptionalString(value.locale)) return false

  switch (value.type) {
    case "query_submitted":
      return (
        typeof value.query === "string" &&
        isNumber(value.resultCount) &&
        value.resultCount >= 0 &&
        isOptionalNumber(value.latencyMs) &&
        isOptionalNumber(value.itemCount) &&
        isOptionalBoolean(value.cacheHit)
      )
    case "result_clicked":
      return (
        typeof value.query === "string" &&
        isNonEmptyString(value.itemId) &&
        isOptionalString(value.itemTitle) &&
        isNumber(value.position) &&
        value.position >= 0 &&
        isOptionalString(value.itemType) &&
        isOptionalString(value.href)
      )
    case "result_dwell":
      return (
        typeof value.query === "string" &&
        isNonEmptyString(value.itemId) &&
        isNumber(value.dwellMs) &&
        value.dwellMs >= 0
      )
    case "zero_results":
      return typeof value.query === "string"
    case "suggestion_used":
      return (
        typeof value.query === "string" &&
        isNonEmptyString(value.suggestion) &&
        (value.source === "didYouMean" || value.source === "related" || value.source === "trending")
      )
    case "experiment_exposure":
    case "experiment_conversion":
      return (
        isNonEmptyString(value.experiment) &&
        isNonEmptyString(value.variant) &&
        (value.type === "experiment_exposure" || isNonEmptyString(value.conversion))
      )
    case "search_performance":
      return (
        isOptionalString(value.query) &&
        isNumber(value.latencyMs) &&
        value.latencyMs >= 0 &&
        isNumber(value.itemCount) &&
        value.itemCount >= 0 &&
        isOptionalBoolean(value.cacheHit) &&
        isOptionalNumber(value.prepareMs)
      )
    case "doc_opened":
      return (
        isOptionalString(value.query) &&
        isOptionalString(value.itemId) &&
        isOptionalString(value.href)
      )
    case "feedback_submitted":
      return isOptionalString(value.query) && isOptionalString(value.source)
    default:
      return false
  }
}

/** Narrow an unknown value to a `SearchEvent`, or null when invalid. */
export function asSearchEvent(value: unknown): SearchEvent | null {
  return validateSearchEvent(value) ? value : null
}
