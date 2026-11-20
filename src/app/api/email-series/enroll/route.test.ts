import { beforeEach, describe, expect, it } from "vitest"

import { resetEmailSeriesForTests } from "@/lib/email-series"
import { POST } from "./route"

let ipCounter = 0

function post(body: unknown, ip?: string) {
  return POST(
    new Request("http://localhost/api/email-series/enroll", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-forwarded-for": ip ?? `10.9.9.${++ipCounter}`,
      },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  )
}

beforeEach(() => {
  resetEmailSeriesForTests()
})

describe("POST /api/email-series/enroll", () => {
  it("rejects malformed JSON", async () => {
    expect((await post("{oops")).status).toBe(400)
  })

  it("rejects invalid emails", async () => {
    const response = await post({ email: "not-an-email" })
    expect(response.status).toBe(400)
  })

  it("enrolls a valid address and is idempotent", async () => {
    const first = await post({ email: "New@User.dev", name: "New" })
    expect(first.status).toBe(200)
    const data = await first.json()
    expect(data).toMatchObject({ ok: true, alreadyEnrolled: false, status: "active" })
    expect(data.sentSteps).toEqual([])

    const second = await post({ email: "new@user.dev" })
    const data2 = await second.json()
    expect(data2.alreadyEnrolled).toBe(true)
  })

  it("blocks cross-origin posts", async () => {
    const response = await POST(
      new Request("http://localhost/api/email-series/enroll", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          origin: "https://evil.example",
        },
        body: JSON.stringify({ email: "a@b.c" }),
      }),
    )
    expect(response.status).toBe(403)
  })

  it("rate limits repeated enrollments from one IP", async () => {
    const ip = "203.0.113.50"
    for (let i = 0; i < 10; i++) {
      const response = await post({ email: `u${i}@example.com` }, ip)
      expect(response.status).toBe(200)
    }
    const blocked = await post({ email: "u10@example.com" }, ip)
    expect(blocked.status).toBe(429)
  })
})
