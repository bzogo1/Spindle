import { beforeEach, describe, expect, it, vi } from "vitest"

import { POST } from "./route"
import { listNpsResponses, resetNpsStore, summarizeNps } from "@/lib/nps"

let ipCounter = 0

function post(body: unknown, ip?: string) {
  return POST(
    new Request("http://localhost/api/nps", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-forwarded-for": ip ?? `10.8.8.${++ipCounter}`,
      },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  )
}

beforeEach(() => {
  resetNpsStore()
  vi.restoreAllMocks()
})

describe("POST /api/nps", () => {
  it("rejects malformed JSON", async () => {
    const response = await post("{not json")
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ ok: false })
  })

  it("rejects invalid payloads with field errors", async () => {
    const response = await post({ score: 42 })
    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.ok).toBe(false)
    expect(data.errors.score).toBeTruthy()
    expect(listNpsResponses()).toHaveLength(0)
  })

  it("silently accepts honeypot submissions without storing them", async () => {
    const response = await post({ score: 10, website: "http://spam.example" })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ ok: true })
    expect(listNpsResponses()).toHaveLength(0)
  })

  it("stores a valid response and acknowledges it", async () => {
    const response = await post({ score: 9, comment: "Fast and reliable", source: "widget" })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ ok: true })

    const stored = listNpsResponses()
    expect(stored).toHaveLength(1)
    expect(stored[0]).toMatchObject({
      score: 9,
      comment: "Fast and reliable",
      source: "widget",
    })
    expect(summarizeNps().score).toBe(100)
  })

  it("accepts a score-only response", async () => {
    const response = await post({ score: 0 })
    expect(response.status).toBe(200)
    expect(listNpsResponses()[0].comment).toBe("")
  })

  it("rate limits repeated submissions from one IP", async () => {
    const ip = "203.0.113.42"
    for (let i = 0; i < 20; i++) {
      const response = await post({ score: 8 }, ip)
      expect(response.status).toBe(200)
    }
    const blocked = await post({ score: 8 }, ip)
    expect(blocked.status).toBe(429)
    expect(await blocked.json()).toMatchObject({ ok: false })
  })
})
