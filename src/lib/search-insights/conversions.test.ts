import { describe, expect, it } from "vitest"

import { computeConversionRates, computeSearchFunnel } from "./conversions"
import { SEARCH_EVENTS_SCHEMA_VERSION, type SearchEvent } from "./schema"

function ev(partial: Partial<SearchEvent> & { type: SearchEvent["type"] }): SearchEvent {
  return {
    schemaVersion: SEARCH_EVENTS_SCHEMA_VERSION,
    ts: 1700000000000,
    ...partial,
  } as SearchEvent
}

describe("computeSearchFunnel", () => {
  it("returns an empty funnel for no events", () => {
    const funnel = computeSearchFunnel([])
    expect(funnel.searches).toBe(0)
    expect(funnel.deepConversionRate).toBe(0)
    expect(funnel.stages.every((s) => s.count === 0)).toBe(true)
  })

  it("computes stage counts, step rates, and overall rates", () => {
    const events: SearchEvent[] = [
      ev({ type: "query_submitted", query: "a", resultCount: 2 }),
      ev({ type: "query_submitted", query: "b", resultCount: 1 }),
      ev({ type: "result_clicked", query: "a", itemId: "i", position: 0 }),
      ev({ type: "doc_opened", query: "a", href: "/docs/x" }),
      ev({ type: "feedback_submitted", query: "a", source: "ui" }),
    ]
    const funnel = computeSearchFunnel(events)
    expect(funnel.searches).toBe(2)

    const [search, click, doc, feedback] = funnel.stages
    expect(search).toMatchObject({ count: 2, stepRate: 1, overallRate: 1 })
    expect(click).toMatchObject({ count: 1, stepRate: 0.5, overallRate: 0.5 })
    expect(doc).toMatchObject({ count: 1, stepRate: 1, overallRate: 0.5 })
    expect(feedback).toMatchObject({ count: 1, stepRate: 1, overallRate: 0.5 })
    // doc_opened + feedback_submitted conversions / searches
    expect(funnel.deepConversionRate).toBeCloseTo(1)
  })

  it("excludes result_clicked from the deep conversion rate", () => {
    const events: SearchEvent[] = [
      ev({ type: "query_submitted", query: "a", resultCount: 2 }),
      ev({ type: "result_clicked", query: "a", itemId: "i", position: 0 }),
    ]
    const funnel = computeSearchFunnel(events)
    // Clicks are engagement, not conversion.
    expect(funnel.deepConversionRate).toBe(0)
  })
})

describe("computeConversionRates", () => {
  it("computes per-search and per-click rates", () => {
    const events: SearchEvent[] = [
      ev({ type: "query_submitted", query: "a", resultCount: 1 }),
      ev({ type: "query_submitted", query: "b", resultCount: 1 }),
      ev({ type: "result_clicked", query: "a", itemId: "i", position: 0 }),
      ev({ type: "doc_opened", query: "a" }),
    ]
    const rates = computeConversionRates(events)
    const click = rates.find((r) => r.conversion === "result_clicked")
    const doc = rates.find((r) => r.conversion === "doc_opened")
    const feedback = rates.find((r) => r.conversion === "feedback_submitted")
    expect(click).toMatchObject({ count: 1, perSearch: 0.5, perClick: 1 })
    expect(doc).toMatchObject({ count: 1, perSearch: 0.5, perClick: 1 })
    expect(feedback).toMatchObject({ count: 0, perSearch: 0, perClick: 0 })
  })
})
