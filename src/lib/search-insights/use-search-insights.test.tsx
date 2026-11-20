import { renderHook, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it } from "vitest"

import { readStoredEvents, resetFlushQueueForTests } from "./store"
import { useTrackedSearch } from "./use-search-insights"

describe("useTrackedSearch", () => {
  beforeEach(() => {
    window.localStorage.clear()
    resetFlushQueueForTests()
  })

  it("returns search results plus tracking helpers", async () => {
    const { result } = renderHook(() =>
      useTrackedSearch({
        providers: [
          {
            id: "pages",
            group: "Pages",
            load: () => [
              {
                id: "page:/docs",
                title: "Documentation",
                group: "Pages",
                type: "page",
                href: "/docs",
              },
            ],
          },
        ],
        query: "documentation",
        enabled: true,
        debounceMs: 1,
      }),
    )

    await waitFor(() => expect(result.current.loading).toBe(false))
    await waitFor(() => expect(result.current.results.length).toBeGreaterThan(0))

    expect(result.current.locale).toBeTruthy()
    expect(typeof result.current.trackClick).toBe("function")
    expect(typeof result.current.trackSuggestion).toBe("function")
    expect(typeof result.current.trackNoResults).toBe("function")

    // query_submitted + search_performance recorded for the settled query.
    await waitFor(() => {
      const types = readStoredEvents().map((e) => e.type)
      expect(types).toContain("query_submitted")
      expect(types).toContain("search_performance")
    })
    const submitted = readStoredEvents().find((e) => e.type === "query_submitted")
    expect(submitted).toMatchObject({ query: "documentation" })
  })

  it("trackClick records result_clicked for the current query", async () => {
    const { result } = renderHook(() =>
      useTrackedSearch({
        providers: [],
        query: "anything",
        enabled: true,
        debounceMs: 1,
      }),
    )
    await waitFor(() => expect(result.current.loading).toBe(false))

    result.current.trackClick(
      {
        item: { id: "x:1", title: "X", group: "G" },
        score: 0,
      } as never,
      0,
    )
    const clicked = readStoredEvents().find((e) => e.type === "result_clicked")
    expect(clicked).toMatchObject({ itemId: "x:1", position: 0 })
  })

  it("re-tracks a repeated query after the query is cleared", async () => {
    const submittedCount = () =>
      readStoredEvents().filter((e) => e.type === "query_submitted").length

    const { result, rerender } = renderHook(
      ({ query }: { query: string }) =>
        useTrackedSearch({ providers: [], query, enabled: true, debounceMs: 1 }),
      { initialProps: { query: "repeat" } },
    )

    await waitFor(() => expect(submittedCount()).toBe(1))

    rerender({ query: "" })
    await waitFor(() => expect(result.current.debouncedQuery).toBe(""))

    rerender({ query: "repeat" })
    await waitFor(() => expect(submittedCount()).toBe(2))
  })

  it("respects trackAnalytics=false", async () => {
    renderHook(() =>
      useTrackedSearch({
        providers: [],
        query: "silent",
        enabled: true,
        debounceMs: 1,
        trackAnalytics: false,
      }),
    )
    // Give effects a tick to run.
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(readStoredEvents().filter((e) => e.type === "query_submitted")).toHaveLength(0)
  })
})
