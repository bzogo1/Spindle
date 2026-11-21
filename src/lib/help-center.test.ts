import { describe, expect, it } from "vitest"

import {
  getArticleBySlug,
  HELP_ARTICLES,
  HELP_CATEGORIES,
  isHelpCategoryId,
  listArticles,
  listCategories,
  relatedArticles,
  searchArticles,
} from "./help-center"

describe("listArticles", () => {
  it("returns every article as a summary, most recently updated first", () => {
    const articles = listArticles()
    expect(articles).toHaveLength(HELP_ARTICLES.length)
    expect(articles[0].updatedAt >= articles[articles.length - 1].updatedAt).toBe(true)
    // Summaries never leak body or keywords.
    expect(articles[0]).not.toHaveProperty("body")
    expect(articles[0]).not.toHaveProperty("keywords")
    expect(articles[0]).toHaveProperty("categoryTitle")
  })

  it("filters by category", () => {
    const billing = listArticles({ category: "billing" })
    expect(billing.length).toBeGreaterThan(0)
    expect(billing.every((article) => article.category === "billing")).toBe(true)
    expect(billing.every((article) => article.categoryTitle === "Billing")).toBe(true)
    expect(listArticles({ category: "getting-started" }).length).toBeGreaterThan(0)
  })
})

describe("getArticleBySlug", () => {
  it("returns the full article including body", () => {
    const article = getArticleBySlug("create-your-first-workspace")
    expect(article).toBeDefined()
    expect(article?.title).toBe("Create your first workspace")
    expect(article?.body.length).toBeGreaterThan(0)
    expect(article?.keywords).toContain("onboarding")
  })

  it("returns undefined for unknown slugs", () => {
    expect(getArticleBySlug("does-not-exist")).toBeUndefined()
  })
})

describe("searchArticles", () => {
  it("returns all articles for an empty query", () => {
    expect(searchArticles("")).toHaveLength(HELP_ARTICLES.length)
    expect(searchArticles("   ")).toHaveLength(HELP_ARTICLES.length)
  })

  it("finds articles by title words", () => {
    const results = searchArticles("password")
    expect(results.map((a) => a.slug)).toContain("reset-your-password")
  })

  it("finds articles by keywords", () => {
    const results = searchArticles("webhook")
    expect(results[0]?.slug).toBe("set-up-webhooks")
  })

  it("requires every token to match (AND semantics)", () => {
    const results = searchArticles("password storage")
    // Both tokens must appear somewhere in the same article.
    for (const article of results) {
      const haystack = `${article.title} ${article.excerpt} ${article.slug}`.toLowerCase()
      expect(haystack.includes("password")).toBe(true)
      expect(haystack.includes("storage")).toBe(true)
    }
    expect(searchArticles("password zzzznomatch")).toHaveLength(0)
  })

  it("respects the category filter", () => {
    // "storage" matches articles in multiple categories; the filter keeps only billing.
    const unfiltered = searchArticles("storage")
    expect(unfiltered.length).toBeGreaterThan(1)
    const results = searchArticles("storage", { category: "billing" })
    expect(results.length).toBeGreaterThan(0)
    expect(results.every((a) => a.category === "billing")).toBe(true)
    expect(results.length).toBeLessThan(unfiltered.length)
  })

  it("respects the limit", () => {
    expect(searchArticles("the", { limit: 3 })).toHaveLength(3)
    expect(searchArticles("the", { limit: 1 })).toHaveLength(1)
  })

  it("ranks title matches above keyword-only matches", () => {
    // "storage" appears in one title and only in keywords/excerpts elsewhere.
    const results = searchArticles("storage")
    expect(results.length).toBeGreaterThan(1)
    expect(results[0]?.slug).toBe("what-happens-at-storage-limits")
    expect(results[0]?.title.toLowerCase()).toContain("storage")
  })
})

describe("listCategories", () => {
  it("returns every category with a count matching the articles", () => {
    const categories = listCategories()
    expect(categories).toHaveLength(HELP_CATEGORIES.length)
    const total = categories.reduce((sum, c) => sum + c.count, 0)
    expect(total).toBe(HELP_ARTICLES.length)
    for (const category of categories) {
      expect(category.count).toBe(HELP_ARTICLES.filter((a) => a.category === category.id).length)
      expect(category.count).toBeGreaterThan(0)
    }
  })
})

describe("relatedArticles", () => {
  it("excludes the selected article and prefers same-category matches", () => {
    const selected = getArticleBySlug("create-your-first-workspace")
    expect(selected).toBeDefined()
    const pool = listArticles()
    const selectedSummary = pool.find((a) => a.slug === selected?.slug)
    expect(selectedSummary).toBeDefined()

    const related = relatedArticles(selectedSummary!, pool, { limit: 4 })
    expect(related.length).toBeGreaterThan(0)
    expect(related.every((a) => a.slug !== selected?.slug)).toBe(true)
    // Same-category articles outrank everything else.
    expect(related.some((a) => a.category === "getting-started")).toBe(true)
    expect(related[0]?.category).toBe("getting-started")
  })

  it("respects the limit and returns summaries only", () => {
    const selected = listArticles()[0]
    const related = relatedArticles(selected, listArticles(), { limit: 2 })
    expect(related).toHaveLength(2)
    expect(related[0]).not.toHaveProperty("body")
    expect(related[0]).not.toHaveProperty("keywords")
  })
})

describe("isHelpCategoryId", () => {
  it("accepts known ids and rejects everything else", () => {
    expect(isHelpCategoryId("billing")).toBe(true)
    expect(isHelpCategoryId("api-integrations")).toBe(true)
    expect(isHelpCategoryId("bogus")).toBe(false)
    expect(isHelpCategoryId("")).toBe(false)
  })
})
