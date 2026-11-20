// @vitest-environment node
import { describe, expect, it } from "vitest"

import { POST } from "./route"

let ipCounter = 0

function post(body: unknown, headers: Record<string, string> = {}) {
  ipCounter += 1
  return POST(
    new Request("http://localhost/api/auth/password/breach", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": `10.9.9.${ipCounter}`,
        ...headers,
      },
      body: JSON.stringify(body),
    }),
  )
}

describe("POST /api/auth/password/breach", () => {
  it("reports a clean password as not breached", async () => {
    const response = await post({ password: "Xk9#mP2$vL8@nQ4wR7" })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toMatchObject({ ok: true, breached: false, reasons: [], severity: null })
  })

  it("reports denylisted and heuristic passwords as breached", async () => {
    const common = await post({ password: "password123" })
    expect(await common.json()).toMatchObject({
      ok: true,
      breached: true,
      severity: "high",
    })

    const weak = await post({ password: "Xk9#abcd1234" })
    const weakBody = await weak.json()
    expect(weakBody).toMatchObject({ ok: true, breached: true, severity: "medium" })
    expect(weakBody.reasons).toContain("sequential_characters")
  })

  it("rejects invalid bodies", async () => {
    expect((await post({})).status).toBe(400)
    expect((await post({ password: 42 })).status).toBe(400)
    expect((await post({ password: "" })).status).toBe(400)
    expect((await post("not-json-object")).status).toBe(400)
  })

  it("blocks cross-origin requests", async () => {
    const response = await post(
      { password: "correct horse" },
      { origin: "https://evil.example", "sec-fetch-site": "cross-site" },
    )
    expect(response.status).toBe(403)
  })

  it("rate limits repeated checks per IP", async () => {
    // The limiter allows 60 checks per 10 minutes; the suite shares the
    // module-level limiter, so fire enough requests from one IP to trip it.
    const headers = { "x-forwarded-for": "10.9.9.250" }
    let lastStatus = 0
    for (let i = 0; i < 61; i += 1) {
      const response = await post({ password: "correct horse" }, headers)
      lastStatus = response.status
    }
    expect(lastStatus).toBe(429)
  })
})
