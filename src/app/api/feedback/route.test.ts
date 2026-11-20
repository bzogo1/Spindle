import { beforeEach, describe, expect, it } from "vitest"

import { feedbackStore } from "@/lib/feedback"

import { POST } from "./route"

let ipCounter = 0

function post(body: unknown, ip?: string) {
  return POST(
    new Request("http://localhost/api/feedback", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-forwarded-for": ip ?? `10.8.8.${++ipCounter}`,
      },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  )
}

const validBody = {
  category: "bug",
  message: "The export button does nothing when clicked twice.",
}

beforeEach(() => {
  feedbackStore.clear()
})

describe("POST /api/feedback", () => {
  it("rejects malformed JSON", async () => {
    const response = await post("{not json")
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ ok: false })
  })

  it("rejects invalid payloads with field errors", async () => {
    const response = await post({ category: "nope", message: "hi" })
    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.ok).toBe(false)
    expect(data.errors.category).toBeTruthy()
    expect(data.errors.message).toBeTruthy()
    expect(feedbackStore.list()).toHaveLength(0)
  })

  it("stores a valid submission and acknowledges it", async () => {
    const response = await post({ ...validBody, email: "ada@lab.edu" })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ ok: true })

    const entries = feedbackStore.list()
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      category: "bug",
      message: validBody.message,
      email: "ada@lab.edu",
    })
    expect(entries[0].id).toBeTruthy()
    expect(entries[0].createdAt).toBeTruthy()
  })

  it("stores submissions without an email", async () => {
    const response = await post({ ...validBody, email: "" })
    expect(response.status).toBe(200)
    expect(feedbackStore.list()[0].email).toBeUndefined()
  })

  it("silently accepts honeypot submissions without storing them", async () => {
    const response = await post({ ...validBody, website: "http://spam.example" })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ ok: true })
    expect(feedbackStore.list()).toHaveLength(0)
  })

  it("rate limits repeated submissions from one IP", async () => {
    const ip = "203.0.113.9"
    for (let i = 0; i < 10; i++) {
      const response = await post(validBody, ip)
      expect(response.status).toBe(200)
    }
    const blocked = await post(validBody, ip)
    expect(blocked.status).toBe(429)
  })
})
