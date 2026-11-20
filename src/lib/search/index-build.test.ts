import { describe, expect, it } from "vitest"

import type { SearchItem } from "./index"
import {
  benchmarkSearch,
  createTokenCache,
  prepareItem,
  prepareItems,
  prepareItemsIncremental,
  sharedTokenCache,
  timeSearch,
  tokenizeWords,
} from "./index-build"

function item(id: string): SearchItem {
  return { id, title: `Title ${id}`, group: "Pages", keywords: "some keywords here" }
}

describe("tokenizeWords / createTokenCache", () => {
  it("lowercases and splits on non-word characters", () => {
    // "+", "#", "." and "-" are kept inside tokens (they appear in routes/versions).
    expect(tokenizeWords("Hello, World! v1.2 foo-bar")).toEqual([
      "hello",
      "world",
      "v1.2",
      "foo-bar",
    ])
  })

  it("memoizes repeated tokenization (same array reference)", () => {
    const tokenize = createTokenCache(10)
    const text = "repeat me repeat me"
    expect(tokenize(text)).toBe(tokenize(text))
    expect(sharedTokenCache("cached text")).toEqual(["cached", "text"])
  })

  it("evicts oldest entries beyond the limit", () => {
    const tokenize = createTokenCache(2)
    const one = tokenize("one")
    const two = tokenize("two")
    const three = tokenize("three") // evicts "one"
    expect(tokenize("one")).not.toBe(one) // recomputed — "one" was evicted
    expect(tokenize("three")).toBe(three) // still cached
    expect(tokenize("two")).not.toBe(two) // evicted along the way
  })
})

describe("prepareItems", () => {
  it("pre-lowercases match fields", () => {
    const prepared = prepareItem({
      id: "x",
      title: "Tide Pool",
      subtitle: "SURVEY",
      keywords: "CSV Export",
      group: "Pages",
    })
    expect(prepared.title).toBe("tide pool")
    expect(prepared.subtitle).toBe("survey")
    expect(prepared.keywords).toBe("csv export")
    expect(prepared.item.id).toBe("x")
  })

  it("prepareItems maps all items in order", () => {
    const prepared = prepareItems([item("a"), item("b")])
    expect(prepared.map((p) => p.item.id)).toEqual(["a", "b"])
  })
})

describe("prepareItemsIncremental", () => {
  it("produces the same result as the sync path and reports progress", async () => {
    const items = Array.from({ length: 10 }, (_, i) => item(`i${i}`))
    const progress: [number, number][] = []
    const prepared = await prepareItemsIncremental(items, {
      chunkSize: 3,
      onProgress: (done, total) => progress.push([done, total]),
    })
    expect(prepared.map((p) => p.item.id)).toEqual(items.map((i) => i.id))
    expect(progress.at(-1)).toEqual([10, 10])
    expect(progress.length).toBeGreaterThan(1)
  })
})

describe("timeSearch / benchmarkSearch", () => {
  it("reports timing info and returns the wrapped result", () => {
    const timings: { query: string; durationMs: number }[] = []
    const result = timeSearch(
      "q",
      5,
      1,
      () => 42,
      (t) => timings.push(t),
    )
    expect(result).toBe(42)
    expect(timings).toHaveLength(1)
    expect(timings[0]).toMatchObject({ query: "q", itemCount: 5, variantCount: 1 })
    expect(timings[0]!.durationMs).toBeGreaterThanOrEqual(0)
  })

  it("benchmarkSearch aggregates per-query timings", () => {
    const bench = benchmarkSearch(["a", "b", "c"], () => [], 3)
    expect(bench.timings).toHaveLength(3)
    expect(bench.totalMs).toBeGreaterThanOrEqual(0)
    expect(bench.meanMs).toBeCloseTo(bench.totalMs / 3, 5)
  })
})
