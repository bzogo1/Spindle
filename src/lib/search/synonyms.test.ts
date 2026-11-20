import { describe, expect, it } from "vitest"

import {
  DEFAULT_SYNONYMS,
  MAX_QUERY_VARIANTS,
  expandQuery,
  synonymsFor,
  withSynonyms,
} from "./synonyms"

describe("synonymsFor", () => {
  it("looks up synonyms case-insensitively", () => {
    expect(synonymsFor("API")).toContain("endpoint")
    expect(synonymsFor("unknown-term")).toEqual([])
  })
})

describe("expandQuery", () => {
  it("returns the original query first", () => {
    const variants = expandQuery("api docs")
    expect(variants[0]).toBe("api docs")
  })

  it("generates single-token substitution variants", () => {
    const variants = expandQuery("api")
    expect(variants).toContain("endpoint")
    expect(variants).toContain("rest")
  })

  it("replaces one token at a time in multi-token queries", () => {
    const variants = expandQuery("api config")
    // One variant swaps "api", another swaps "config" — never both at once.
    expect(variants).toContain("endpoint config")
    expect(variants).toContain("api configuration")
    expect(variants).not.toContain("endpoint configuration")
  })

  it("deduplicates and caps variants", () => {
    const variants = expandQuery(
      "api auth deploy file project team workflow secret notif member invite billing config doc lab search theme",
    )
    expect(variants.length).toBeLessThanOrEqual(MAX_QUERY_VARIANTS)
    expect(new Set(variants.map((v) => v.toLowerCase())).size).toBe(variants.length)
  })

  it("returns no variants for an empty query", () => {
    expect(expandQuery("   ")).toEqual([])
  })
})

describe("withSynonyms", () => {
  it("merges extra entries without mutating the base", () => {
    const merged = withSynonyms(DEFAULT_SYNONYMS, { API: ["webhook"], custom: ["thing"] })
    expect(synonymsFor("api", merged)).toContain("webhook")
    expect(synonymsFor("custom", merged)).toEqual(["thing"])
    expect(synonymsFor("api", DEFAULT_SYNONYMS)).not.toContain("webhook")
  })
})
