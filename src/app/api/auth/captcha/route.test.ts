// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest"

import { resetCaptchaStoreForTests } from "@/lib/captcha"
import { GET } from "./route"

let ipCounter = 0

function get(headers: Record<string, string> = {}) {
  ipCounter += 1
  return GET(
    new Request("http://localhost/api/auth/captcha", {
      method: "GET",
      headers: { "x-forwarded-for": `10.9.9.${ipCounter}`, ...headers },
    }),
  )
}

beforeEach(() => {
  resetCaptchaStoreForTests()
})

describe("GET /api/auth/captcha", () => {
  it("issues a solvable challenge", async () => {
    const response = await get()
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toMatchObject({ ok: true })
    expect(body.challengeId).toMatch(/^[0-9a-f]{16}$/)
    expect(body.prefix).toContain(body.challengeId)
    expect(body.difficulty).toBeGreaterThanOrEqual(1)
    expect(body.difficulty).toBeLessThanOrEqual(28)
    expect(Date.parse(body.expiresAt)).toBeGreaterThan(Date.now())
  })

  it("rejects cross-origin requests", async () => {
    const response = await get({ origin: "https://evil.example" })
    expect(response.status).toBe(403)
  })
})
