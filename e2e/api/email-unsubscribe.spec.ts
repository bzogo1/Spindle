import { createHmac } from "node:crypto"

import { expect, test } from "playwright/test"

import { getServerEnv } from "../../src/lib/env.server"
import { siteFormFailSchema, unsubscribePostOkSchema, unsubscribeStatusSchema } from "./contract"
import { jsonBody } from "./helpers"

/**
 * Contract specs for `/api/email/unsubscribe` (GET status check + POST
 * one-click/JSON mutation).
 *
 * Tokens are HMAC-SHA256 envelopes (`u1.<payload>.<sig>`, see
 * `src/lib/email-unsubscribe.ts`). The signing key is `SESSION_SECRET` when
 * configured and a well-known dev fallback otherwise — `.env.local` ships
 * without `SESSION_SECRET`, so specs mint tokens with the same fallback.
 * `getServerEnv()` is used so a `SESSION_SECRET` exported in the shell is
 * honored; a secret that exists only inside `.env.local` (loaded by
 * `next dev` but not by the test runner) would still produce 400s — keep
 * unsubscribe-token secrets in the shell env or accept the dev fallback.
 */

const DEV_FALLBACK_SECRET = "spindle-dev-only-insecure-unsubscribe-secret"
const UNSUBSCRIBE_DOMAIN = "email-unsubscribe"

function signingSecret(): string {
  // Mirrors `signingKeys()` in src/lib/email-unsubscribe.ts: SESSION_SECRET
  // first, then SESSION_SECRET_PREVIOUS, then the dev fallback.
  const env = getServerEnv()
  const configured = env.SESSION_SECRET ?? env.SESSION_SECRET_PREVIOUS
  return configured && configured.length > 0 ? configured : DEV_FALLBACK_SECRET
}

/** Replicates `createUnsubscribeToken` from `src/lib/email-unsubscribe.ts`. */
function mintUnsubscribeToken(
  email: string,
  scope = "marketing",
): { token: string; email: string } {
  const now = Math.floor(Date.now() / 1000)
  const payload = {
    purpose: "email-unsubscribe",
    email: email.trim().toLowerCase(),
    scope,
    iat: now,
    exp: now + 180 * 24 * 60 * 60,
  }
  const body = `${UNSUBSCRIBE_DOMAIN}.u1.${Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")}`
  const signature = createHmac("sha256", signingSecret()).update(body).digest("base64url")
  return { token: `${body}.${signature}`, email: payload.email }
}

function uniqueEmail(tag: string): string {
  return `contract-unsub-${tag}-${Date.now()}@example.com`
}

test.describe("GET /api/email/unsubscribe", () => {
  test("rejects a missing token", async ({ request }) => {
    const response = await request.get("/api/email/unsubscribe")
    expect(response.status()).toBe(400)
    siteFormFailSchema.parse(await jsonBody(response))
  })

  test("rejects a forged token", async ({ request }) => {
    const response = await request.get("/api/email/unsubscribe?token=u1.forged.signature")
    expect(response.status()).toBe(400)
    siteFormFailSchema.parse(await jsonBody(response))
  })

  test("returns subscription status for a valid token without mutating", async ({ request }) => {
    const { token, email } = mintUnsubscribeToken(uniqueEmail("get"))

    const response = await request.get(`/api/email/unsubscribe?token=${token}&email=${email}`)
    expect(response.status()).toBe(200)

    const body = unsubscribeStatusSchema.parse(await jsonBody(response))
    expect(body.ok).toBe(true)
    expect(body.email).toBe(email)
    expect(body.scope).toBe("marketing")
    expect(body.subscribed).toBe(true)
    expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now())
  })

  test("rejects when the email param disagrees with the token", async ({ request }) => {
    const { token } = mintUnsubscribeToken(uniqueEmail("mismatch"))
    const response = await request.get(
      `/api/email/unsubscribe?token=${token}&email=someone-else@example.com`,
    )
    expect(response.status()).toBe(400)
    siteFormFailSchema.parse(await jsonBody(response))
  })
})

test.describe("POST /api/email/unsubscribe", () => {
  test("unsubscribes via a JSON body and is idempotent", async ({ request }) => {
    const { token, email } = mintUnsubscribeToken(uniqueEmail("post"))

    const first = await request.post("/api/email/unsubscribe", {
      data: { token, email },
    })
    expect(first.status()).toBe(200)
    const firstBody = unsubscribePostOkSchema.parse(await jsonBody(first))
    expect(firstBody.subscribed).toBe(false)
    expect(firstBody.email).toBe(email)

    // GET now reports the address as unsubscribed.
    const status = await request.get(`/api/email/unsubscribe?token=${token}`)
    expect(status.status()).toBe(200)
    const statusBody = unsubscribeStatusSchema.parse(await jsonBody(status))
    expect(statusBody.subscribed).toBe(false)

    // A second POST is a no-op success (idempotent).
    const second = await request.post("/api/email/unsubscribe", { data: { token } })
    expect(second.status()).toBe(200)
    unsubscribePostOkSchema.parse(await jsonBody(second))
  })

  test("accepts an RFC 8058 one-click form post", async ({ request }) => {
    const { token, email } = mintUnsubscribeToken(uniqueEmail("oneclick"))
    const response = await request.post("/api/email/unsubscribe", {
      data: `List-Unsubscribe=One-Click&token=${encodeURIComponent(token)}`,
      headers: { "content-type": "application/x-www-form-urlencoded" },
    })
    expect(response.status()).toBe(200)

    const body = unsubscribePostOkSchema.parse(await jsonBody(response))
    expect(body.email).toBe(email)
    expect(body.subscribed).toBe(false)
    expect(body.message).toBe("Unsubscribed.")
  })

  test("rejects an invalid token in a JSON body", async ({ request }) => {
    const response = await request.post("/api/email/unsubscribe", {
      data: { token: "u1.bogus.sig" },
    })
    expect(response.status()).toBe(400)
    siteFormFailSchema.parse(await jsonBody(response))
  })

  test("rejects a malformed JSON body", async ({ request }) => {
    const response = await request.post("/api/email/unsubscribe", {
      data: "{oops",
      headers: { "content-type": "application/json" },
    })
    expect(response.status()).toBe(400)
    siteFormFailSchema.parse(await jsonBody(response))
  })
})
