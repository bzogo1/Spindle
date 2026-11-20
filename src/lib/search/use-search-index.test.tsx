import { act, renderHook, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { SearchIndexProvider, SearchItem } from "./index"
import { useSearchIndex } from "./use-search-index"
import { SearchResultCache } from "./cache"
import { trendingQueries } from "./suggestions"

function item(partial: Partial<SearchItem> & Pick<SearchItem, "id" | "title">): SearchItem {
  return { group: "Pages", ...partial }
}

function provider(id: string, items: SearchItem[], cacheKey?: string): SearchIndexProvider {
  return { id, group: "Pages", cacheKey, load: () => items }
}

const pages = [
  item({ id: "page:/dashboard", title: "Dashboard" }),
  item({ id: "page:/settings", title: "Settings" }),
]

afterEach(() => {
  vi.useRealTimers()
})

beforeEach(() => {
  window.localStorage.clear()
  window.sessionStorage.clear()
})

describe("useSearchIndex", () => {
  it("debounces the query before computing results", async () => {
    const { result, rerender } = renderHook(
      ({ query }) =>
        useSearchIndex({
          providers: [provider("pages", pages)],
          query,
          enabled: true,
          debounceMs: 40,
        }),
      { initialProps: { query: "dash" } },
    )

    await waitFor(() => expect(result.current.loading).toBe(false))
    await waitFor(() => expect(result.current.debouncedQuery).toBe("dash"))

    rerender({ query: "sett" })
    // The debounced value still reflects the previous query.
    expect(result.current.debouncedQuery).toBe("dash")

    await waitFor(() => expect(result.current.debouncedQuery).toBe("sett"))
    expect(result.current.results.map((hit) => hit.item.id)).toEqual(["page:/settings"])
  })

  it("loads providers immediately when enabled", async () => {
    const load = vi.fn(() => pages)
    const { result } = renderHook(() =>
      useSearchIndex({
        providers: [{ id: "pages", group: "Pages", load }],
        query: "",
        enabled: true,
      }),
    )

    expect(result.current.loading).toBe(true)
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(load).toHaveBeenCalledTimes(1)
    // Empty query returns every loaded item.
    expect(result.current.results).toHaveLength(pages.length)
    expect(result.current.debouncedQuery).toBe("")
  })

  it("does not load while disabled until the idle preload delay", async () => {
    vi.useFakeTimers()
    const load = vi.fn(() => pages)

    const { result } = renderHook(() =>
      useSearchIndex({
        providers: [{ id: "pages", group: "Pages", load }],
        query: "",
        enabled: false,
      }),
    )

    expect(result.current.loading).toBe(true)
    expect(load).not.toHaveBeenCalled()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_499)
    })
    expect(load).not.toHaveBeenCalled()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2)
    })

    expect(load).toHaveBeenCalledTimes(1)
    expect(result.current.loading).toBe(false)
    expect(result.current.results).toHaveLength(pages.length)
  })

  it("loads immediately when enabled flips to true without waiting for idle", async () => {
    vi.useFakeTimers()
    const load = vi.fn(() => pages)
    const providers = [{ id: "pages", group: "Pages", load }]

    const { result, rerender } = renderHook(
      ({ enabled }) => useSearchIndex({ providers, query: "", enabled }),
      { initialProps: { enabled: false } },
    )

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })
    expect(load).not.toHaveBeenCalled()

    rerender({ enabled: true })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(load).toHaveBeenCalledTimes(1)
    expect(result.current.loading).toBe(false)
  })

  it("reloads providers when the provider list changes after the first load", async () => {
    const firstLoad = vi.fn(() => [item({ id: "a", title: "Alpha" })])
    const secondLoad = vi.fn(() => [item({ id: "b", title: "Beta" })])

    const { result, rerender } = renderHook(
      ({ providers }) => useSearchIndex({ providers, query: "", enabled: true }),
      {
        initialProps: {
          providers: [
            { id: "pages", group: "Pages", cacheKey: "v1", load: firstLoad },
          ] satisfies SearchIndexProvider[],
        },
      },
    )

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.results.map((hit) => hit.item.title)).toEqual(["Alpha"])

    rerender({
      providers: [
        { id: "pages", group: "Pages", cacheKey: "v2", load: secondLoad },
      ] satisfies SearchIndexProvider[],
    })

    await waitFor(() =>
      expect(result.current.results.map((hit) => hit.item.title)).toEqual(["Beta"]),
    )
    expect(firstLoad).toHaveBeenCalledTimes(1)
    expect(secondLoad).toHaveBeenCalledTimes(1)
  })

  it("keeps cached providers when only the array identity changes", async () => {
    const load = vi.fn(() => pages)
    const base = { id: "pages", group: "Pages", cacheKey: "stable", load }

    const { result, rerender } = renderHook(
      ({ providers }) => useSearchIndex({ providers, query: "", enabled: true }),
      { initialProps: { providers: [base] satisfies SearchIndexProvider[] } },
    )

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(load).toHaveBeenCalledTimes(1)

    // A new array with the same provider shape must not refetch.
    rerender({ providers: [{ ...base }] satisfies SearchIndexProvider[] })
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(load).toHaveBeenCalledTimes(1)
    expect(result.current.results).toHaveLength(pages.length)
  })

  it("searchNow searches synchronously against loaded items", async () => {
    const { result } = renderHook(() =>
      useSearchIndex({
        providers: [provider("pages", pages)],
        query: "dash",
        enabled: true,
        debounceMs: 10_000,
      }),
    )

    await waitFor(() => expect(result.current.loading).toBe(false))
    // The debounced query has not caught up, but searchNow bypasses it.
    expect(result.current.debouncedQuery).toBe("dash")

    const hits = result.current.searchNow("settings")
    expect(hits.map((hit) => hit.item.id)).toEqual(["page:/settings"])
    expect(result.current.searchNow("no-such-page")).toEqual([])
  })

  it("applies filters to results while facets stay computed over unfiltered hits", async () => {
    const mixed: SearchItem[] = [
      item({ id: "page:/x", title: "Export", type: "page", section: "Product" }),
      item({ id: "doc:g:s", title: "Export guide", type: "doc", section: "Guides" }),
    ]
    const { result } = renderHook(() =>
      useSearchIndex({
        providers: [provider("mixed", mixed)],
        query: "export",
        enabled: true,
        debounceMs: 10,
        filters: { types: ["doc"] },
        cache: null,
      }),
    )

    await waitFor(() => expect(result.current.loading).toBe(false))
    await waitFor(() => expect(result.current.results.map((h) => h.item.id)).toEqual(["doc:g:s"]))

    // Facets see both types even though results are filtered to docs.
    expect(result.current.facets.type).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: "page", count: 1 }),
        expect.objectContaining({ value: "doc", count: 1 }),
      ]),
    )
    expect(result.current.unfilteredResults).toHaveLength(2)
  })

  it("exposes did-you-mean suggestions for misspelled queries", async () => {
    const { result } = renderHook(() =>
      useSearchIndex({
        providers: [provider("pages", [item({ id: "a", title: "Dashboard" })])],
        query: "dashbord",
        enabled: true,
        debounceMs: 10,
        cache: null,
      }),
    )

    await waitFor(() => expect(result.current.loading).toBe(false))
    await waitFor(() =>
      expect(result.current.suggestions.didYouMean[0]?.suggestion).toBe("Dashboard"),
    )
  })

  it("caches results and invalidates when the index version changes", async () => {
    const cache = new SearchResultCache({ persist: false })
    const load = vi.fn(() => [item({ id: "a", title: "Alpha" })])
    const providers = [{ id: "pages", group: "Pages", cacheKey: "v1", load }]

    const { result, rerender } = renderHook(
      ({ providers }) =>
        useSearchIndex({ providers, query: "alpha", enabled: true, debounceMs: 10, cache }),
      { initialProps: { providers: providers as SearchIndexProvider[] } },
    )

    await waitFor(() => expect(result.current.results).toHaveLength(1))
    const firstScore = result.current.results[0]!.score

    // Same query again — served from cache (identical results).
    rerender({ providers: providers as SearchIndexProvider[] })
    await waitFor(() => expect(result.current.results).toHaveLength(1))
    expect(result.current.results[0]!.score).toBe(firstScore)

    // Provider reload bumps the index version → cache key changes → fresh search.
    rerender({
      providers: [
        {
          id: "pages",
          group: "Pages",
          cacheKey: "v2",
          load: vi.fn(() => [item({ id: "b", title: "Alphabet" })]),
        },
      ] as SearchIndexProvider[],
    })
    await waitFor(() => expect(result.current.results.map((h) => h.item.id)).toEqual(["b"]))
  })

  it("records executed queries for trending suggestions", async () => {
    const { result } = renderHook(() =>
      useSearchIndex({
        providers: [provider("pages", pages)],
        query: "dashboard",
        enabled: true,
        debounceMs: 10,
        cache: null,
      }),
    )

    await waitFor(() => expect(result.current.debouncedQuery).toBe("dashboard"))
    await waitFor(() => expect(trendingQueries(5)).toContain("dashboard"))
  })
})
