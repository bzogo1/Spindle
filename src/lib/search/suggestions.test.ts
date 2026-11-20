import { beforeEach, describe, expect, it } from "vitest"

import type { SearchItem } from "./index"
import {
  QUERY_LOG_STORAGE_KEY,
  clearQueryLog,
  readQueryLog,
  recordSearchQuery,
  relatedQueries,
  searchSuggestions,
  spellingCandidates,
  trendingQueries,
} from "./suggestions"

function item(partial: Partial<SearchItem> & Pick<SearchItem, "id" | "title">): SearchItem {
  return { group: "Pages", ...partial }
}

beforeEach(() => {
  window.localStorage.clear()
})

describe("query log", () => {
  it("records queries and ranks trending by frequency + recency", () => {
    const now = 1_000_000
    recordSearchQuery("deploy", now)
    recordSearchQuery("deploy", now)
    recordSearchQuery("billing", now - 1000)
    recordSearchQuery("x", now) // too short — ignored

    const log = readQueryLog(now)
    expect(log.map((entry) => entry.query)).toContain("deploy")
    expect(log.find((entry) => entry.query === "deploy")?.count).toBe(2)
    expect(log.some((entry) => entry.query === "x")).toBe(false)
    expect(window.localStorage.getItem(QUERY_LOG_STORAGE_KEY)).toContain("deploy")

    expect(trendingQueries(5, now)[0]).toBe("deploy")
  })

  it("falls back to item titles when the log is empty", () => {
    const items = [item({ id: "a", title: "Alpha Page" }), item({ id: "b", title: "Beta Page" })]
    expect(trendingQueries(5, Date.now(), items)).toEqual(["Alpha Page", "Beta Page"])
  })

  it("clearQueryLog wipes the store", () => {
    recordSearchQuery("deploy")
    clearQueryLog()
    expect(readQueryLog()).toHaveLength(0)
  })
})

describe("relatedQueries", () => {
  const items = [
    item({ id: "a", title: "Deploy pipelines", subtitle: "CI/CD setup" }),
    item({ id: "b", title: "Billing plans", subtitle: "Pricing tiers" }),
    item({ id: "c", title: "Unrelated zebra" }),
    item({ id: "d", title: "Deploy checklist" }),
  ]

  it("finds candidates sharing tokens, synonyms included", () => {
    // "endpoint" is a synonym of "api" in the default dictionary.
    const related = relatedQueries("api", {
      items: [...items, item({ id: "e", title: "REST endpoint guide" })],
    })
    expect(related).toContain("REST endpoint guide")
  })

  it("excludes the query itself and unrelated items", () => {
    const related = relatedQueries("deploy pipelines", { items })
    expect(related).not.toContain("deploy pipelines")
    expect(related).not.toContain("Unrelated zebra")
    expect(related).toContain("Deploy checklist")
    expect(related.length).toBeGreaterThan(0)
  })
})

describe("searchSuggestions", () => {
  it("returns did-you-mean for misspellings and trending always", () => {
    const items = [item({ id: "a", title: "Dashboard" }), item({ id: "b", title: "Settings" })]
    const result = searchSuggestions("dashbord", { items })
    expect(result.didYouMean[0]?.suggestion).toBe("Dashboard")
    expect(result.trending.length).toBeGreaterThan(0)
  })

  it("spellingCandidates dedupes and prefers item titles", () => {
    const items = [item({ id: "a", title: "Dashboard" }), item({ id: "b", title: "Dashboard" })]
    recordSearchQuery("Custom Query")
    const candidates = spellingCandidates(items)
    expect(candidates.filter((c) => c === "Dashboard")).toHaveLength(1)
    expect(candidates).toContain("Custom Query")
  })
})
