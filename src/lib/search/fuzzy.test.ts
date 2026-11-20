import { describe, expect, it } from "vitest"

import {
  FIELD_PENALTIES,
  editDistance,
  fuzzyScore,
  scoreSearchFields,
  scoreSearchFieldsNormalized,
  suggestSpellingCorrections,
} from "./fuzzy"

describe("fuzzyScore", () => {
  it("returns 0 for an empty query", () => {
    expect(fuzzyScore("", "anything")).toBe(0)
  })

  it("prefers substring matches over subsequence matches", () => {
    const substring = fuzzyScore("pool", "Tide Pool Survey")
    const subsequence = fuzzyScore("tpl", "Tide Pool Survey")
    expect(substring).not.toBeNull()
    expect(subsequence).not.toBeNull()
    expect(substring!).toBeLessThan(subsequence!)
  })

  it("returns null when the query is not a subsequence", () => {
    expect(fuzzyScore("xyz", "Tide Pool Survey")).toBeNull()
  })

  it("rewards word-boundary matches", () => {
    const boundary = fuzzyScore("survey", "Tide Pool Survey")
    const midWord = fuzzyScore("vey", "Tide Pool Survey")
    expect(boundary!).toBeLessThan(midWord!)
  })
})

describe("scoreSearchFields", () => {
  const item = {
    title: "Tide Pool Survey",
    subtitle: "Weekly tide pool measurements",
    keywords: "tide-pool-survey csv",
  }

  it("matches on the title with no penalty", () => {
    const score = scoreSearchFields("tide pool", item)
    expect(score).toBe(fuzzyScore("tide pool", item.title))
  })

  it("penalizes subtitle matches relative to title matches", () => {
    const titleHit = scoreSearchFields("survey", { title: "Survey results" })
    const subtitleHit = scoreSearchFields("measurements", item)
    expect(titleHit).not.toBeNull()
    expect(subtitleHit).not.toBeNull()
    // Same-position hits: the subtitle hit carries FIELD_PENALTIES.subtitle.
    expect(subtitleHit!).toBeGreaterThanOrEqual(FIELD_PENALTIES.subtitle)
  })

  it("penalizes keyword matches the most", () => {
    const keywordOnly = scoreSearchFields("csv", {
      title: "Unrelated",
      keywords: "data csv export",
    })
    expect(keywordOnly!).toBeGreaterThanOrEqual(FIELD_PENALTIES.keywords)
  })

  it("returns the best field score when several fields match", () => {
    const score = scoreSearchFields("tide", item)
    const titleScore = fuzzyScore("tide", item.title)!
    expect(score).toBe(titleScore)
  })

  it("returns null when nothing matches", () => {
    expect(scoreSearchFields("zzz", item)).toBeNull()
  })

  it("accepts custom field penalties", () => {
    const fields = { title: "Alpha", keywords: "beta" }
    const defaultScore = scoreSearchFields("beta", fields)!
    const cheapKeywords = scoreSearchFields("beta", fields, {
      title: 0,
      subtitle: 20,
      keywords: 0,
    })!
    // Removing the keyword penalty must improve (lower) the score.
    expect(cheapKeywords).toBeLessThan(defaultScore)
  })

  it("scoreSearchFieldsNormalized matches the lowercase path", () => {
    const fields = { title: "Tide Pool", subtitle: "Surveys", keywords: "csv" }
    const lowered = {
      title: fields.title.toLowerCase(),
      subtitle: fields.subtitle!.toLowerCase(),
      keywords: fields.keywords!.toLowerCase(),
    }
    expect(scoreSearchFieldsNormalized("tide", lowered)).toBe(scoreSearchFields("tide", fields))
  })
})

describe("editDistance", () => {
  it("computes classic Levenshtein distances", () => {
    expect(editDistance("kitten", "sitting")).toBe(3)
    expect(editDistance("", "abc")).toBe(3)
    expect(editDistance("abc", "abc")).toBe(0)
    expect(editDistance("abc", "abd")).toBe(1)
  })

  it("is symmetric and handles swaps", () => {
    expect(editDistance("ab", "ba")).toBe(editDistance("ba", "ab"))
  })

  it("honors the maxDistance bound", () => {
    expect(editDistance("kitten", "sitting", 2)).toBe(3)
    expect(editDistance("kitten", "sitting", 3)).toBe(3)
  })
})

describe("suggestSpellingCorrections", () => {
  const candidates = ["Dashboard", "Settings", "Documentation", "Collaborate", "FAQ"]

  it("suggests close matches with confidence", () => {
    const suggestions = suggestSpellingCorrections("dashbord", candidates)
    expect(suggestions[0]?.suggestion).toBe("Dashboard")
    expect(suggestions[0]!.confidence).toBeGreaterThan(0.5)
  })

  it("skips exact matches, short queries, and distant candidates", () => {
    expect(suggestSpellingCorrections("Dashboard", candidates)).toEqual([])
    expect(suggestSpellingCorrections("ab", candidates)).toEqual([])
    expect(suggestSpellingCorrections("zzzzzz", candidates)).toEqual([])
  })

  it("respects the confidence threshold and limit", () => {
    const strict = suggestSpellingCorrections("seting", candidates, { minConfidence: 0.99 })
    expect(strict).toEqual([])
    const many = suggestSpellingCorrections("documintation", [...candidates, "Document"], {
      limit: 1,
    })
    expect(many).toHaveLength(1)
  })
})
