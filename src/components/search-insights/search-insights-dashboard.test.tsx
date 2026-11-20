import { render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it } from "vitest"

import { SearchInsightsDashboard } from "./search-insights-dashboard"
import {
  appendSearchEvents,
  resetFlushQueueForTests,
  SEARCH_EVENTS_STORAGE_KEY,
} from "@/lib/search-insights/store"
import { SEARCH_EVENTS_SCHEMA_VERSION } from "@/lib/search-insights/schema"

function seed() {
  const day = 24 * 60 * 60 * 1000
  const now = Date.now()
  appendSearchEvents([
    {
      schemaVersion: SEARCH_EVENTS_SCHEMA_VERSION,
      ts: now - day,
      type: "query_submitted",
      query: "deploy pipeline",
      resultCount: 3,
      locale: "en",
    },
    {
      schemaVersion: SEARCH_EVENTS_SCHEMA_VERSION,
      ts: now - day + 1000,
      type: "query_submitted",
      query: "nothing matches this",
      resultCount: 0,
      locale: "uk",
    },
    {
      schemaVersion: SEARCH_EVENTS_SCHEMA_VERSION,
      ts: now - day + 2000,
      type: "result_clicked",
      query: "deploy pipeline",
      itemId: "doc:deploy:pipeline",
      position: 0,
      locale: "en",
    },
    {
      schemaVersion: SEARCH_EVENTS_SCHEMA_VERSION,
      ts: now - day + 3000,
      type: "search_performance",
      latencyMs: 12,
      itemCount: 250,
      cacheHit: true,
    },
  ])
}

describe("SearchInsightsDashboard", () => {
  beforeEach(() => {
    window.localStorage.clear()
    resetFlushQueueForTests()
  })

  it("shows an empty state when no events exist", () => {
    render(<SearchInsightsDashboard />)
    expect(screen.getByText(/No search events recorded yet/)).toBeInTheDocument()
  })

  it("renders totals, top queries, funnel, locale, and performance", () => {
    seed()
    render(<SearchInsightsDashboard />)

    expect(screen.getByText("Search insights")).toBeInTheDocument()
    expect(screen.getByText("deploy pipeline")).toBeInTheDocument()
    expect(screen.getByText("By language")).toBeInTheDocument()
    expect(screen.getByText("Conversion funnel")).toBeInTheDocument()
    expect(screen.getByText("Performance")).toBeInTheDocument()
    expect(screen.getByText("Cache hit rate")).toBeInTheDocument()
    // CTR: 1 click / 2 searches = 50%
    expect(screen.getAllByText("50.0%").length).toBeGreaterThan(0)
  })

  it("clear data empties the dashboard", async () => {
    const { default: userEvent } = await import("@testing-library/user-event")
    seed()
    render(<SearchInsightsDashboard />)
    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: "Clear data" }))
    expect(screen.getByText(/No search events recorded yet/)).toBeInTheDocument()
    expect(window.localStorage.getItem(SEARCH_EVENTS_STORAGE_KEY)).toBeNull()
  })
})
