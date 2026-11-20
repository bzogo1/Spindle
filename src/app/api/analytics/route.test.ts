import { beforeEach, describe, expect, it } from "vitest"

import { getAnalyticsSummary, resetAnalyticsStoreForTests } from "@/lib/analytics"
import { createAccessToken } from "@/lib/auth/token-codec"
import { CONSENT_COOKIE, CONSENT_VERSION } from "@/lib/consent"

import { POST } from "./route"

const UID = "user-analytics-ingest"

function authCookie() {
  const { token } = createAccessToken({
    sid: "sid-1",
    uid: UID,
    email: "a@b.c",
    name: "A",
  })
  return `spindle_at=${token}`
}

function consentCookie(analytics = true) {
  const payload = encodeURIComponent(
    JSON.stringify({
      version: CONSENT_VERSION,
      timestamp: new Date().toISOString(),
      analytics,
      replay: false,
    }),
  )
  return `${CONSENT_COOKIE}=${payload}`
}

function post(body: unknown, cookie?: string, headers: Record<string, string> = {}) {
  return POST(
    new Request("http://localhost/api/analytics", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(cookie ? { cookie } : {}),
        ...headers,
      },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  )
}

const validEvent = {
  type: "page_view",
  name: "page_view",
  path: "/app",
  props: {},
  timestamp: Date.now(),
  anonymousId: "anon-test",
}

beforeEach(() => {
  resetAnalyticsStoreForTests()
})

describe("POST /api/analytics", () => {
  it("rejects cross-origin requests", async () => {
    const response = await post({ events: [validEvent] }, consentCookie(), {
      origin: "https://evil.example.com",
    })
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ ok: false, code: "forbidden" })
  })

  it("rejects requests without analytics consent", async () => {
    expect((await post({ events: [validEvent] })).status).toBe(403)

    const rejected = await post({ events: [validEvent] }, consentCookie(false))
    expect(rejected.status).toBe(403)
    expect(await rejected.json()).toMatchObject({ ok: false, code: "consent_required" })

    // A stale policy version reads as undecided → also rejected.
    const stale = `${CONSENT_COOKIE}=${encodeURIComponent(
      JSON.stringify({ version: "0.9", timestamp: "x", analytics: true, replay: false }),
    )}`
    expect((await post({ events: [validEvent] }, stale)).status).toBe(403)
  })

  it("rejects malformed JSON and invalid event payloads", async () => {
    const cookie = consentCookie()
    expect((await post("{nope", cookie)).status).toBe(400)
    expect((await post({}, cookie)).status).toBe(400)
    expect((await post({ events: [] }, cookie)).status).toBe(400)
    expect((await post({ events: [{ ...validEvent, type: "bogus" }] }, cookie)).status).toBe(400)
    expect((await post({ events: [{ ...validEvent, timestamp: "soon" }] }, cookie)).status).toBe(
      400,
    )
  })

  it("stores anonymous events when no session is present", async () => {
    const response = await post(
      { events: [validEvent, { ...validEvent, type: "feature_use", name: "search" }] },
      consentCookie(),
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ ok: true, accepted: 2 })

    const summary = getAnalyticsSummary({ days: 30, userId: null })
    expect(summary.totals.events).toBe(2)
    expect(summary.totals.pageViews).toBe(1)
    expect(summary.totals.featureUses).toBe(1)
  })

  it("attributes events to the session principal when signed in", async () => {
    const cookie = `${authCookie()}; ${consentCookie()}`
    const response = await post({ events: [validEvent] }, cookie)
    expect(response.status).toBe(200)

    const mine = getAnalyticsSummary({ days: 30, userId: `user:${UID}` })
    expect(mine.totals.events).toBe(1)

    const other = getAnalyticsSummary({ days: 30, userId: "user:someone-else" })
    expect(other.totals.events).toBe(0)
  })
})
