import { beforeEach, describe, expect, it } from "vitest"

import { resetShareTrackingForTests, shareClickCount } from "@/lib/share-tracking"

import { POST } from "./route"

function post(body: unknown, headers: Record<string, string> = {}) {
  return POST(
    new Request("http://localhost/api/share/track", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  )
}

beforeEach(() => {
  resetShareTrackingForTests()
})

describe("POST /api/share/track", () => {
  it("records a platform click and returns 204", async () => {
    const response = await post({ platform: "x", code: "SPN-ABCD-EFGH" })
    expect(response.status).toBe(204)
    expect(shareClickCount("x", "SPN-ABCD-EFGH")).toBe(1)
  })

  it("accepts platform without a code", async () => {
    const response = await post({ platform: "copy" })
    expect(response.status).toBe(204)
    expect(shareClickCount("copy")).toBe(1)
  })

  it("rejects unknown platforms", async () => {
    const response = await post({ platform: "myspace" })
    expect(response.status).toBe(400)
  })

  it("rejects malformed JSON", async () => {
    const response = await post("{not json")
    expect(response.status).toBe(400)
  })

  it("rejects cross-origin requests", async () => {
    const response = await post(
      { platform: "x" },
      { origin: "https://evil.example", "sec-fetch-site": "cross-site" },
    )
    expect(response.status).toBe(403)
    expect(shareClickCount("x")).toBe(0)
  })
})
