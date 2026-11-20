import type { SearchEvent } from "./schema"

/**
 * Aggregation layer over stored search events: totals, top queries,
 * zero-result rate, click-through rate, per-day trend, per-locale stats,
 * and experiment summaries. All functions are pure — pass the event array
 * (from `readStoredEvents`) and get derived metrics back.
 */

export type TopQueryEntry = {
  query: string
  count: number
  /** Submissions that produced at least one result. */
  withResults: number
  zeroResultCount: number
}

export type DailyPoint = {
  /** YYYY-MM-DD (UTC). */
  date: string
  queries: number
  clicks: number
  zeroResults: number
}

export type LocaleStats = {
  locale: string
  queries: number
  clicks: number
  zeroResults: number
  /** clicks / queries, 0..1. */
  ctr: number
}

export type SearchInsightsSummary = {
  totals: {
    queries: number
    clicks: number
    dwellEvents: number
    zeroResults: number
    suggestionsUsed: number
    /** Unique normalized queries. */
    uniqueQueries: number
  }
  /** queries with resultCount === 0 / total queries, 0..1. */
  zeroResultRate: number
  /** result_clicked / query_submitted, 0..1. */
  clickThroughRate: number
  topQueries: TopQueryEntry[]
  daily: DailyPoint[]
  byLocale: LocaleStats[]
  /** First and last event timestamps (0 when empty). */
  range: { firstTs: number; lastTs: number }
}

function normalizeQuery(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, " ")
}

function dayKey(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10)
}

function pct(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0
}

export function computeSearchInsightsSummary(
  events: SearchEvent[],
  options: { topQueries?: number; days?: number } = {},
): SearchInsightsSummary {
  const topLimit = options.topQueries ?? 10
  const dayLimit = options.days ?? 30

  const queries = new Map<string, TopQueryEntry & { lastTs: number }>()
  const daily = new Map<string, DailyPoint>()
  const localeMap = new Map<string, { queries: number; clicks: number; zeroResults: number }>()

  // Pre-scan: keys of zero-result `query_submitted` events, so standalone
  // `zero_results` events emitted for the same query on the same day are
  // recognized as duplicates and not double-counted (findings: daily and
  // totals zero-result accounting).
  const zeroSubmissionKeys = new Set<string>()
  for (const event of events) {
    if (event.type === "query_submitted" && event.resultCount === 0) {
      const key = normalizeQuery(event.query)
      if (key) zeroSubmissionKeys.add(`${dayKey(event.ts)}|${key}`)
    }
  }

  let clickCount = 0
  let dwellCount = 0
  let suggestionCount = 0
  let zeroFromSubmissions = 0
  /** zero_results events not paired with a query_submitted (same query+day). */
  let standaloneZeroResults = 0
  let firstTs = Infinity
  let lastTs = 0

  const bumpLocale = (locale: string | undefined) => {
    const key = locale?.trim() || "unknown"
    let entry = localeMap.get(key)
    if (!entry) {
      entry = { queries: 0, clicks: 0, zeroResults: 0 }
      localeMap.set(key, entry)
    }
    return entry
  }

  const bumpDaily = (ts: number) => {
    const key = dayKey(ts)
    let point = daily.get(key)
    if (!point) {
      point = { date: key, queries: 0, clicks: 0, zeroResults: 0 }
      daily.set(key, point)
    }
    return point
  }

  for (const event of events) {
    if (event.ts < firstTs) firstTs = event.ts
    if (event.ts > lastTs) lastTs = event.ts

    switch (event.type) {
      case "query_submitted": {
        const key = normalizeQuery(event.query)
        if (!key) break
        let entry = queries.get(key)
        if (!entry) {
          entry = { query: key, count: 0, withResults: 0, zeroResultCount: 0, lastTs: 0 }
          queries.set(key, entry)
        }
        entry.count += 1
        entry.lastTs = event.ts
        if (event.resultCount > 0) entry.withResults += 1
        else entry.zeroResultCount += 1

        bumpLocale(event.locale).queries += 1
        const point = bumpDaily(event.ts)
        point.queries += 1
        if (event.resultCount === 0) {
          zeroFromSubmissions += 1
          bumpLocale(event.locale).zeroResults += 1
          point.zeroResults += 1
        }
        break
      }
      case "result_clicked": {
        clickCount += 1
        bumpLocale(event.locale).clicks += 1
        bumpDaily(event.ts).clicks += 1
        break
      }
      case "result_dwell":
        dwellCount += 1
        break
      case "zero_results": {
        // Standalone zero-result signal: skip when a query_submitted for the
        // same normalized query on the same day already accounted for it.
        const key = `${dayKey(event.ts)}|${normalizeQuery(event.query)}`
        if (zeroSubmissionKeys.has(key)) break
        standaloneZeroResults += 1
        bumpLocale(event.locale).zeroResults += 1
        bumpDaily(event.ts).zeroResults += 1
        break
      }
      case "suggestion_used":
        suggestionCount += 1
        break
      default:
        break
    }
  }

  const totalQueries = [...queries.values()].reduce((sum, entry) => sum + entry.count, 0)
  // Each real zero-result search counts once: submissions contribute via
  // `resultCount === 0`; standalone `zero_results` events fill the gap when
  // no paired submission exists (e.g. only trackZeroResults was called).
  const zeroTotal = zeroFromSubmissions + standaloneZeroResults
  // Standalone zero_results events represent searches too — include them in
  // the rate denominator so a zero_results-only dataset yields rate 1, not 0.
  const searchesForRate = totalQueries + standaloneZeroResults

  const topQueries = [...queries.values()]
    .sort((a, b) => b.count - a.count || a.query.localeCompare(b.query))
    .slice(0, topLimit)
    .map(({ lastTs: _lastTs, ...entry }) => entry)

  const dailyPoints = [...daily.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-dayLimit)

  const byLocale: LocaleStats[] = [...localeMap.entries()]
    .map(([locale, stats]) => ({
      locale,
      queries: stats.queries,
      clicks: stats.clicks,
      zeroResults: stats.zeroResults,
      ctr: pct(stats.clicks, stats.queries),
    }))
    .sort((a, b) => b.queries - a.queries || a.locale.localeCompare(b.locale))

  return {
    totals: {
      queries: totalQueries,
      clicks: clickCount,
      dwellEvents: dwellCount,
      zeroResults: zeroTotal,
      suggestionsUsed: suggestionCount,
      uniqueQueries: queries.size,
    },
    zeroResultRate: pct(zeroTotal, searchesForRate),
    clickThroughRate: pct(clickCount, totalQueries),
    topQueries,
    daily: dailyPoints,
    byLocale,
    range: {
      firstTs: Number.isFinite(firstTs) ? firstTs : 0,
      lastTs,
    },
  }
}

// ---------------------------------------------------------------------------
// Experiment summaries (task 38 reporting)
// ---------------------------------------------------------------------------

export type ExperimentSummary = {
  experiment: string
  variants: {
    variant: string
    exposures: number
    conversions: number
    /** conversions / exposures, 0..1. */
    conversionRate: number
  }[]
}

export function computeExperimentSummaries(events: SearchEvent[]): ExperimentSummary[] {
  const map = new Map<
    string,
    Map<string, { exposures: number; conversions: Map<string, number> }>
  >()

  for (const event of events) {
    if (event.type !== "experiment_exposure" && event.type !== "experiment_conversion") continue
    let variants = map.get(event.experiment)
    if (!variants) {
      variants = new Map()
      map.set(event.experiment, variants)
    }
    let entry = variants.get(event.variant)
    if (!entry) {
      entry = { exposures: 0, conversions: new Map() }
      variants.set(event.variant, entry)
    }
    if (event.type === "experiment_exposure") {
      entry.exposures += 1
    } else {
      entry.conversions.set(event.conversion, (entry.conversions.get(event.conversion) ?? 0) + 1)
    }
  }

  return [...map.entries()]
    .map(([experiment, variants]) => ({
      experiment,
      variants: [...variants.entries()]
        .map(([variant, entry]) => {
          const conversions = [...entry.conversions.values()].reduce((a, b) => a + b, 0)
          return {
            variant,
            exposures: entry.exposures,
            conversions,
            conversionRate: pct(conversions, entry.exposures),
          }
        })
        .sort((a, b) => b.exposures - a.exposures || a.variant.localeCompare(b.variant)),
    }))
    .sort((a, b) => a.experiment.localeCompare(b.experiment))
}
