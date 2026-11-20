// @vitest-environment node
import { describe, expect, it } from "vitest"

import { HELP_ARTICLES, HELP_CATEGORIES } from "@/lib/help-center"
import { GET } from "./route"

let ipCounter = 0

function request(url = "http://localhost/api/help/articles", ip?: string) {
  ipCounter += 1
  return new Request(url, {
    headers: { "x-forwarded-for": ip ?? `10.20.0.${ipCounter}` },
  })
}

describe("GET /api/help/articles", () => {
  it("returns all articles as summaries plus categories", async () => {
    const response = await GET(request())
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.ok).toBe(true)
    expect(data.articles).toHaveLength(HELP_ARTICLES.length)
    expect(data.categories).toHaveLength(HELP_CATEGORIES.length)
    // Summaries must not leak body or keywords.
    expect(data.articles[0]).not.toHaveProperty("body")
    expect(data.articles[0]).not.toHaveProperty("keywords")
    expect(data.articles[0]).toHaveProperty("categoryTitle")
  })

  it("filters by category", async () => {
    const response = await GET(request("http://localhost/api/help/articles?category=billing"))
    const data = await response.json()
    expect(response.status).toBe(200)
    expect(data.articles.length).toBeGreaterThan(0)
    expect(data.articles.every((a: { category: string }) => a.category === "billing")).toBe(true)
  })

  it("rejects unknown categories", async () => {
    const response = await GET(request("http://localhost/api/help/articles?category=bogus"))
    expect(response.status).toBe(400)
  })

  it("searches with ?q=", async () => {
    const response = await GET(request("http://localhost/api/help/articles?q=webhook"))
    const data = await response.json()
    expect(response.status).toBe(200)
    expect(data.articles[0]?.slug).toBe("set-up-webhooks")
  })

  it("clamps limit and rejects invalid values", async () => {
    const limited = await GET(request("http://localhost/api/help/articles?limit=2"))
    expect((await limited.json()).articles).toHaveLength(2)

    const bad = await GET(request("http://localhost/api/help/articles?limit=abc"))
    expect(bad.status).toBe(400)
  })

  it("rate limits per IP after 60 requests", async () => {
    const ip = "10.20.99.1"
    let lastStatus = 0
    for (let i = 0; i < 61; i += 1) {
      const response = await GET(request(undefined, ip))
      lastStatus = response.status
    }
    expect(lastStatus).toBe(429)
  })
})
