import { expect, test } from "playwright/test"

/**
 * Contract specs for `/api/csp-report` — the public CSP violation collector.
 *
 * The route is unauthenticated by design (browsers POST reports directly) and
 * always answers `204 No Content` for POST so browsers neither retry nor
 * surface errors — including malformed JSON and oversized bodies. GET answers
 * `405`. There is no JSON envelope to schema-check; the contract is the
 * status code plus empty body.
 */

test.describe("POST /api/csp-report", () => {
  test("accepts a legacy report-uri payload", async ({ request }) => {
    const response = await request.post("/api/csp-report", {
      headers: { "content-type": "application/csp-report" },
      data: {
        "csp-report": {
          "document-uri": "https://spindle.example/app",
          "violated-directive": "script-src-elem",
          "effective-directive": "script-src-elem",
          "blocked-uri": "https://evil.example/inject.js",
          disposition: "enforce",
        },
      },
    })
    expect(response.status()).toBe(204)
    expect(await response.text()).toBe("")
  })

  test("accepts a Reporting API (report-to) batch", async ({ request }) => {
    const response = await request.post("/api/csp-report", {
      headers: { "content-type": "application/reports+json" },
      data: [
        {
          type: "csp-violation",
          age: 0,
          url: "https://spindle.example/app",
          user_agent: "contract-test",
          body: {
            documentURL: "https://spindle.example/app",
            violatedDirective: "img-src",
            effectiveDirective: "img-src",
            blockedURL: "https://tracker.example/pixel.png",
            disposition: "report",
          },
        },
      ],
    })
    expect(response.status()).toBe(204)
    expect(await response.text()).toBe("")
  })

  test("still answers 204 for malformed JSON", async ({ request }) => {
    const response = await request.post("/api/csp-report", {
      headers: { "content-type": "application/csp-report" },
      data: "this is not json{{{",
    })
    expect(response.status()).toBe(204)
    expect(await response.text()).toBe("")
  })

  test("still answers 204 for a syntactically valid but non-report body", async ({ request }) => {
    const response = await request.post("/api/csp-report", {
      headers: { "content-type": "application/json" },
      data: { unrelated: "payload" },
    })
    expect(response.status()).toBe(204)
    expect(await response.text()).toBe("")
  })
})

test("GET /api/csp-report answers 405", async ({ request }) => {
  const response = await request.get("/api/csp-report")
  expect(response.status()).toBe(405)
  const body = (await response.json()) as { error?: string }
  expect(body.error).toBe("method not allowed")
})
