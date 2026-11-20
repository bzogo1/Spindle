import { describe, expect, it } from "vitest"

import { computeExperimentSummaries, computeSearchInsightsSummary } from "./analytics"
import { SEARCH_EVENTS_SCHEMA_VERSION, type SearchEvent } from "./schema"

function ev(partial: Partial<SearchEvent> & { type: SearchEvent["type"] }): SearchEvent {
  return {
    schemaVersion: SEARCH_EVENTS_SCHEMA_VERSION,
    ts: 1700000000000,
    locale: "en",
    ...partial,
  } as SearchEvent
}

describe("computeSearchInsightsSummary", () => {
  it("returns zeroed summary for no events", () => {
    const summary = computeSearchInsightsSummary([])
    expect(summary.totals.queries).toBe(0)
    expect(summary.zeroResultRate).toBe(0)
    expect(summary.clickThroughRate).toBe(0)
    expect(summary.range).toEqual({ firstTs: 0, lastTs: 0 })
  })

  it("aggregates queries, clicks, zero results, locales, daily", () => {
    const day = 24 * 60 * 60 * 1000
    const ts = Date.UTC(2024, 0, 10)
    const events: SearchEvent[] = [
      ev({ type: "query_submitted", query: "Deploy", resultCount: 3, ts, locale: "en" }),
      ev({ type: "query_submitted", query: "deploy", resultCount: 3, ts: ts + 1000, locale: "en" }),
      ev({
        type: "query_submitted",
        query: "missing",
        resultCount: 0,
        ts: ts + 2000,
        locale: "uk",
      }),
      ev({
        type: "result_clicked",
        query: "deploy",
        itemId: "i1",
        position: 0,
        ts: ts + 3000,
        locale: "en",
      }),
      ev({
        type: "suggestion_used",
        query: "de",
        suggestion: "deploy",
        source: "related",
        ts: ts + 4000,
      }),
      ev({ type: "result_dwell", query: "deploy", itemId: "i1", dwellMs: 5000, ts: ts + 5000 }),
      // Next day
      ev({ type: "query_submitted", query: "other", resultCount: 1, ts: ts + day, locale: "en" }),
    ]

    const summary = computeSearchInsightsSummary(events, { days: 30 })
    expect(summary.totals.queries).toBe(4)
    expect(summary.totals.uniqueQueries).toBe(3)
    expect(summary.totals.clicks).toBe(1)
    expect(summary.totals.zeroResults).toBe(1)
    expect(summary.totals.suggestionsUsed).toBe(1)
    expect(summary.totals.dwellEvents).toBe(1)
    expect(summary.clickThroughRate).toBeCloseTo(0.25)
    expect(summary.zeroResultRate).toBeCloseTo(0.25)

    const deploy = summary.topQueries.find((q) => q.query === "deploy")
    expect(deploy?.count).toBe(2)

    expect(summary.daily).toHaveLength(2)
    expect(summary.daily[0]?.queries).toBe(3)
    expect(summary.daily[1]?.queries).toBe(1)

    const en = summary.byLocale.find((l) => l.locale === "en")
    const uk = summary.byLocale.find((l) => l.locale === "uk")
    expect(en?.queries).toBe(3)
    expect(uk?.queries).toBe(1)
    expect(en?.ctr).toBeCloseTo(1 / 3)
  })

  it("dedupes paired zero_results events and counts standalone ones", () => {
    const ts = Date.UTC(2024, 0, 10)
    const events: SearchEvent[] = [
      // Paired: submission with 0 results + explicit zero_results event.
      ev({ type: "query_submitted", query: "alpha", resultCount: 0, ts, locale: "en" }),
      ev({ type: "zero_results", query: "alpha", ts: ts + 500, locale: "en" }),
      // Standalone: zero_results with no matching submission.
      ev({ type: "zero_results", query: "beta", ts: ts + 1000, locale: "en" }),
      // Normal query.
      ev({ type: "query_submitted", query: "gamma", resultCount: 2, ts: ts + 2000, locale: "en" }),
    ]
    const summary = computeSearchInsightsSummary(events)
    // alpha counted once (submission), beta once (standalone) → 2 zeros.
    expect(summary.totals.zeroResults).toBe(2)
    // Denominator: 2 submissions + 1 standalone zero search = 3.
    expect(summary.zeroResultRate).toBeCloseTo(2 / 3)
    // Daily zero bucket for that day: alpha + beta = 2 (not 3).
    const point = summary.daily.find((d) => d.date === "2024-01-10")
    expect(point?.zeroResults).toBe(2)
  })

  it("zeroResultRate is 1 when only zero_results events exist", () => {
    const ts = Date.UTC(2024, 0, 10)
    const events: SearchEvent[] = [
      ev({ type: "zero_results", query: "a", ts, locale: "en" }),
      ev({ type: "zero_results", query: "b", ts: ts + 1, locale: "en" }),
    ]
    const summary = computeSearchInsightsSummary(events)
    expect(summary.totals.zeroResults).toBe(2)
    expect(summary.zeroResultRate).toBe(1)
  })

  it("does not dedupe zero_results across different days", () => {
    const day = 24 * 60 * 60 * 1000
    const ts = Date.UTC(2024, 0, 10)
    const events: SearchEvent[] = [
      ev({ type: "query_submitted", query: "alpha", resultCount: 0, ts }),
      // Same query, next day — a different real search.
      ev({ type: "zero_results", query: "alpha", ts: ts + day }),
    ]
    const summary = computeSearchInsightsSummary(events)
    expect(summary.totals.zeroResults).toBe(2)
  })

  it("limits daily points to the days window", () => {
    const day = 24 * 60 * 60 * 1000
    const events = Array.from({ length: 10 }, (_, i) =>
      ev({
        type: "query_submitted",
        query: `q${i}`,
        resultCount: 1,
        ts: Date.UTC(2024, 0, 1) + i * day,
      }),
    )
    const summary = computeSearchInsightsSummary(events, { days: 5 })
    expect(summary.daily).toHaveLength(5)
  })
})

describe("computeExperimentSummaries", () => {
  it("groups exposures and conversions per variant", () => {
    const events: SearchEvent[] = [
      ev({ type: "experiment_exposure", experiment: "exp", variant: "a" }),
      ev({ type: "experiment_exposure", experiment: "exp", variant: "a" }),
      ev({ type: "experiment_exposure", experiment: "exp", variant: "b" }),
      ev({ type: "experiment_conversion", experiment: "exp", variant: "a", conversion: "click" }),
    ]
    const [exp] = computeExperimentSummaries(events)
    expect(exp?.experiment).toBe("exp")
    const a = exp?.variants.find((v) => v.variant === "a")
    const b = exp?.variants.find((v) => v.variant === "b")
    expect(a).toMatchObject({ exposures: 2, conversions: 1 })
    expect(a?.conversionRate).toBeCloseTo(0.5)
    expect(b).toMatchObject({ exposures: 1, conversions: 0 })
  })
})
