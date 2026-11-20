import { expect, test } from "playwright/test"

import {
  contactOkSchema,
  feedbackOkSchema,
  newsletterOkSchema,
  npsOkSchema,
  siteFormFailSchema,
  VALID_CONTACT_BODY,
  VALID_FEEDBACK_BODY,
  VALID_NEWSLETTER_BODY,
  VALID_NPS_BODY,
} from "./contract"
import { jsonBody } from "./helpers"

/**
 * Contract specs for the public site-form routes:
 *
 *   POST /api/contact     — ticketed support message (rate limit: 5/hour/IP)
 *   POST /api/newsletter  — marketing-list signup with consent flag
 *   POST /api/feedback    — in-app feedback widget submissions
 *   POST /api/nps         — NPS survey responses
 *
 * All four share the site-form envelope (`{ ok, message, errors? }` — no
 * `code` field) and the `website` honeypot. The contact limiter is the
 * tightest (5/hour per client IP, in-memory per instance), so this file
 * deliberately issues at most 4 POSTs to /api/contact — retries could push
 * a run over the limit and surface a 429 instead of the contract under test.
 */

test.describe("POST /api/contact", () => {
  test("accepts a valid submission and returns a ticket reference", async ({ request }) => {
    const response = await request.post("/api/contact", { data: VALID_CONTACT_BODY })
    expect(response.status()).toBe(200)

    const body = contactOkSchema.parse(await jsonBody(response))
    expect(body.ok).toBe(true)
    expect(body.reference).toMatch(/^CT-[0-9A-F]{8}$/)
  })

  test("rejects an invalid body with per-field errors", async ({ request }) => {
    const response = await request.post("/api/contact", {
      data: { ...VALID_CONTACT_BODY, email: "not-an-email" },
    })
    expect(response.status()).toBe(400)

    const body = siteFormFailSchema.parse(await jsonBody(response))
    expect(body.ok).toBe(false)
    expect(body.errors?.email).toBeTruthy()
  })

  test("answers honeypot submissions with silent success", async ({ request }) => {
    const response = await request.post("/api/contact", {
      data: { ...VALID_CONTACT_BODY, website: "https://spam.example" },
    })
    expect(response.status()).toBe(200)

    const body = await jsonBody<{ ok: boolean; message: string; reference?: string }>(response)
    expect(body.ok).toBe(true)
    // No ticket is minted for honeypot hits — bots learn nothing.
    expect(body.reference).toBeUndefined()
  })
})

test.describe("POST /api/newsletter", () => {
  test("accepts a consented subscription", async ({ request }) => {
    const response = await request.post("/api/newsletter", { data: VALID_NEWSLETTER_BODY })
    expect(response.status()).toBe(200)
    newsletterOkSchema.parse(await jsonBody(response))
  })

  test("rejects a subscription without explicit consent", async ({ request }) => {
    const { consent: _consent, ...withoutConsent } = VALID_NEWSLETTER_BODY
    const response = await request.post("/api/newsletter", { data: withoutConsent })
    expect(response.status()).toBe(400)

    const body = siteFormFailSchema.parse(await jsonBody(response))
    expect(body.ok).toBe(false)
    expect(body.errors?.consent).toBeTruthy()
  })

  test("rejects a malformed JSON body", async ({ request }) => {
    const response = await request.post("/api/newsletter", {
      data: "{not json",
      headers: { "content-type": "application/json" },
    })
    expect(response.status()).toBe(400)
    siteFormFailSchema.parse(await jsonBody(response))
  })
})

test.describe("POST /api/feedback", () => {
  test("accepts a valid submission", async ({ request }) => {
    const response = await request.post("/api/feedback", { data: VALID_FEEDBACK_BODY })
    expect(response.status()).toBe(200)
    feedbackOkSchema.parse(await jsonBody(response))
  })

  test("rejects an unknown category", async ({ request }) => {
    const response = await request.post("/api/feedback", {
      data: { ...VALID_FEEDBACK_BODY, category: "not-a-category" },
    })
    expect(response.status()).toBe(400)

    const body = siteFormFailSchema.parse(await jsonBody(response))
    expect(body.ok).toBe(false)
    expect(body.errors?.category).toBeTruthy()
  })
})

test.describe("POST /api/nps", () => {
  test("accepts a valid survey response", async ({ request }) => {
    const response = await request.post("/api/nps", { data: VALID_NPS_BODY })
    expect(response.status()).toBe(200)
    npsOkSchema.parse(await jsonBody(response))
  })

  test("rejects an out-of-range score", async ({ request }) => {
    const response = await request.post("/api/nps", {
      data: { ...VALID_NPS_BODY, score: 11 },
    })
    expect(response.status()).toBe(400)

    const body = siteFormFailSchema.parse(await jsonBody(response))
    expect(body.ok).toBe(false)
    expect(body.errors?.score).toBeTruthy()
  })
})

test.describe("unsupported methods", () => {
  test("GET /api/contact is not allowed", async ({ request }) => {
    const response = await request.get("/api/contact")
    expect(response.status()).toBe(405)
  })
})
