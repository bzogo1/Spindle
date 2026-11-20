// @vitest-environment node
import { describe, expect, it } from "vitest"

import { getArticleBySlug } from "@/lib/help-center"
import { GET } from "./route"

let ipCounter = 0

function request(slug: string, ip?: string) {
  ipCounter += 1
  return new Request(`http://localhost/api/help/articles/${slug}`, {
    headers: { "x-forwarded-for": ip ?? `10.21.0.${ipCounter}` },
  })
}

function context(slug: string) {
  return { params: Promise.resolve({ slug }) }
}

describe("GET /api/help/articles/[slug]", () => {
  it("returns a full article including body", async () => {
    const article = getArticleBySlug("create-your-first-workspace")
    const response = await GET(request(article!.slug), context(article!.slug))
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.ok).toBe(true)
    expect(data.article.slug).toBe(article!.slug)
    expect(data.article.body.length).toBeGreaterThan(0)
    expect(data.article).toHaveProperty("keywords")
    expect(data.categories.length).toBeGreaterThan(0)
  })

  it("returns 404 for unknown slugs", async () => {
    const response = await GET(request("nope"), context("nope"))
    expect(response.status).toBe(404)
    const data = await response.json()
    expect(data.ok).toBe(false)
  })

  it("rate limits per IP", async () => {
    const ip = "10.21.99.1"
    let lastStatus = 0
    for (let i = 0; i < 61; i += 1) {
      const response = await GET(
        request("create-your-first-workspace", ip),
        context("create-your-first-workspace"),
      )
      lastStatus = response.status
    }
    expect(lastStatus).toBe(429)
  })
})
