import { describe, expect, it } from "vitest"

import { DOCS_SEARCH_INDEX, DOC_GUIDE_SUMMARIES, searchDocs, tokenizeQuery } from "./docs-search"

describe("docs search index", () => {
  it("links every section to its guide route and anchor", () => {
    for (const entry of DOCS_SEARCH_INDEX) {
      expect(entry.href).toBe(
        entry.sectionId === entry.guideId
          ? `/docs/${entry.guideId}`
          : `/docs/${entry.guideId}#${entry.sectionId}`,
      )
      expect(entry.text.length).toBeGreaterThan(0)
    }
  })

  it("includes intro entries and heading sections", () => {
    const searchEntries = DOCS_SEARCH_INDEX.filter((entry) => entry.guideId === "search")

    expect(searchEntries.map((entry) => entry.sectionTitle)).toEqual([
      "Local search",
      "Two search modes",
      "Keep the sources",
      "Try it on the homepage",
    ])
  })

  it("lists one summary per guide", () => {
    expect(DOC_GUIDE_SUMMARIES).toHaveLength(10)
    expect(DOC_GUIDE_SUMMARIES[0]).toMatchObject({ id: "quickstart" })
  })
})

describe("searchDocs", () => {
  it("returns nothing for an empty or whitespace query", () => {
    expect(searchDocs("")).toEqual([])
    expect(searchDocs("   ")).toEqual([])
  })

  it("finds a term that only appears in body text", () => {
    const [result] = searchDocs("SearXNG")

    expect(result).toMatchObject({
      guideId: "search",
      guideTitle: "Local search",
      sectionTitle: "Two search modes",
      href: "/docs/search#search-two-search-modes",
    })
    expect(result.snippet).toContain("SearXNG")
  })

  it("ranks title matches above body-only matches", () => {
    const results = searchDocs("workspace")

    expect(results[0]).toMatchObject({ guideId: "workspaces", titleMatch: true })
    expect(results.some((result) => !result.titleMatch && result.guideId !== "workspaces")).toBe(
      true,
    )
  })

  it("requires every token to match (AND semantics)", () => {
    expect(searchDocs("SearXNG automations")).toEqual([])
    expect(searchDocs("SearXNG modes")).not.toEqual([])
  })

  it("is case-insensitive and ignores surrounding whitespace", () => {
    expect(searchDocs("  searxng  ")[0]?.guideId).toBe("search")
    expect(searchDocs("SEARXNG")[0]?.guideId).toBe("search")
  })

  it("marks body-only matches and clips long snippets", () => {
    const [result] = searchDocs("teammates")

    expect(result.titleMatch).toBe(false)
    expect(result.snippet).toMatch(/teammates/i)
    expect(result.snippet.length).toBeLessThan(170)
  })

  it("reports no results for an unknown term", () => {
    expect(searchDocs("kubernetes")).toEqual([])
  })

  it("searches a caller-provided index", () => {
    const index = [
      {
        guideId: "custom",
        guideTitle: "Custom guide",
        sectionId: "custom-section",
        sectionTitle: "A custom section",
        href: "/docs/custom#custom-section",
        text: "Needle in a haystack.",
      },
    ]

    expect(searchDocs("needle", index)).toHaveLength(1)
    expect(searchDocs("needle", index)[0].score).toBeGreaterThan(0)
    expect(searchDocs("missing", index)).toEqual([])
  })

  it("returns at most eight results", () => {
    expect(searchDocs("the").length).toBeLessThanOrEqual(8)
  })

  it("normalizes and dedupes tokens", () => {
    expect(tokenizeQuery("  Lab   LAB lab ")).toEqual(["lab"])
    expect(tokenizeQuery("")).toEqual([])
  })
})
