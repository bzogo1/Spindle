import { expect, test } from "playwright/test"

import {
  analyticsIngestSchema,
  analyticsSummarySchema,
  authFailSchema,
  cohortsSchema,
  communicationPreferencesSchema,
  digestResultSchema,
  profileSchema,
  publishOkSchema,
} from "./contract"
import {
  analyticsConsentCookieHeader,
  apiOrigin,
  cookieHeader,
  jsonBody,
  mockSessionCookieHeader,
  readFirstSseChunk,
} from "./helpers"

/**
 * Contract specs for the authenticated account routes that resolve the
 * caller through the two-mode session gate (`spindle_at` access cookie, or
 * the unsigned `spindle_mock_session` cookie when `NEXT_PUBLIC_MOCK_AUTH=1`).
 *
 * The playwright webServer always starts with mock auth enabled, so these
 * specs forge the mock-session cookie directly (see helpers.ts). Against a
 * deployment without mock auth every authenticated case would 401 — the
 * unauthenticated assertions remain valid everywhere.
 */

const MOCK_EMAIL = `contract-account-${Date.now()}@example.com`
const AUTH = { cookie: mockSessionCookieHeader(MOCK_EMAIL) }

test.describe("unauthenticated access", () => {
  const guarded: Array<{ method: "get" | "post"; path: string; body?: unknown }> = [
    { method: "get", path: "/api/profile" },
    { method: "get", path: "/api/communication-preferences" },
    { method: "get", path: "/api/cohorts" },
    { method: "get", path: "/api/analytics/summary" },
    { method: "get", path: "/api/notifications/stream" },
    { method: "get", path: "/api/activity/stream" },
    { method: "post", path: "/api/notifications", body: { type: "read_all" } },
    { method: "post", path: "/api/activity", body: { type: "activity", activity: {} } },
    { method: "post", path: "/api/notifications/digest", body: { frequency: "daily" } },
  ]

  for (const route of guarded) {
    test(`${route.method.toUpperCase()} ${route.path} answers 401 without a session`, async ({
      request,
    }) => {
      const response =
        route.method === "get"
          ? await request.get(route.path)
          : await request.post(route.path, { data: route.body })
      expect(response.status()).toBe(401)
      const body = authFailSchema.parse(await jsonBody(response))
      expect(body.code).toBe("unauthenticated")
    })
  }

  test("POST /api/analytics requires the consent cookie", async ({ request }) => {
    const response = await request.post("/api/analytics", {
      data: { events: [{ type: "feature_use", name: "contract" }] },
    })
    expect(response.status()).toBe(403)
    const body = authFailSchema.parse(await jsonBody(response))
    expect(body.code).toBe("consent_required")
  })
})

test.describe("GET/PUT /api/profile", () => {
  test("GET returns the mock session's profile", async ({ request }) => {
    const response = await request.get("/api/profile", { headers: AUTH })
    expect(response.status()).toBe(200)

    const body = profileSchema.parse(await jsonBody(response))
    expect(body.profile.email).toBe(MOCK_EMAIL)
    expect(body.profile.name.length).toBeGreaterThan(0)
  })

  test("PUT updates the display name", async ({ request }) => {
    const response = await request.put("/api/profile", {
      headers: AUTH,
      data: { name: "Contract User Renamed" },
    })
    expect(response.status()).toBe(200)

    const body = profileSchema.parse(await jsonBody(response))
    expect(body.profile.name).toBe("Contract User Renamed")
    // Email is identity, not profile data — it cannot be edited here.
    expect(body.profile.email).toBe(MOCK_EMAIL)
  })

  test("PUT rejects an empty display name with 422", async ({ request }) => {
    const response = await request.put("/api/profile", {
      headers: AUTH,
      data: { name: "   " },
    })
    expect(response.status()).toBe(422)
    const body = authFailSchema.parse(await jsonBody(response))
    expect(body.code).toBe("invalid_name")
  })
})

test.describe("GET/PUT /api/communication-preferences", () => {
  test("GET returns defaults merged with stored overrides", async ({ request }) => {
    const response = await request.get("/api/communication-preferences", { headers: AUTH })
    expect(response.status()).toBe(200)

    const body = communicationPreferencesSchema.parse(await jsonBody(response))
    expect(body.preferences.securityAlerts).toBe(true)
    expect(["off", "daily", "weekly"]).toContain(body.preferences.digestFrequency)
  })

  test("PUT applies a partial update", async ({ request }) => {
    const response = await request.put("/api/communication-preferences", {
      headers: AUTH,
      data: { preferences: { digestFrequency: "daily", referralProgram: true } },
    })
    expect(response.status()).toBe(200)

    const body = communicationPreferencesSchema.parse(await jsonBody(response))
    expect(body.preferences.digestFrequency).toBe("daily")
    expect(body.preferences.referralProgram).toBe(true)
  })

  test("PUT rejects disabling security alerts with 422", async ({ request }) => {
    const response = await request.put("/api/communication-preferences", {
      headers: AUTH,
      data: { preferences: { securityAlerts: false } },
    })
    expect(response.status()).toBe(422)
    const body = authFailSchema.parse(await jsonBody(response))
    expect(body.code).toBe("invalid_preferences")
  })
})

test.describe("GET /api/cohorts", () => {
  test("returns the demo cohort report for a signed-in principal", async ({ request }) => {
    const response = await request.get("/api/cohorts", { headers: AUTH })
    expect(response.status()).toBe(200)

    const body = cohortsSchema.parse(await jsonBody(response))
    expect(body.report.dataSource).toBe("demo")
    expect(body.report.weeks).toBeGreaterThan(0)
    expect(Array.isArray(body.report.cohorts)).toBe(true)
  })
})

test.describe("POST /api/analytics + GET /api/analytics/summary", () => {
  test("ingests consented events and counts them", async ({ request }) => {
    const response = await request.post("/api/analytics", {
      headers: {
        cookie: cookieHeader(mockSessionCookieHeader(MOCK_EMAIL), analyticsConsentCookieHeader()),
      },
      data: {
        events: [
          { type: "page_view", name: "contract_page", path: "/contract" },
          { type: "feature_use", name: "contract_feature" },
        ],
      },
    })
    expect(response.status()).toBe(200)

    const body = analyticsIngestSchema.parse(await jsonBody(response))
    expect(body.accepted).toBe(2)
  })

  test("rejects events without the consent cookie even when signed in", async ({ request }) => {
    const response = await request.post("/api/analytics", {
      headers: AUTH,
      data: { events: [{ type: "feature_use", name: "contract" }] },
    })
    expect(response.status()).toBe(403)
    authFailSchema.parse(await jsonBody(response))
  })

  test("GET /api/analytics/summary returns the aggregate shape", async ({ request }) => {
    const response = await request.get("/api/analytics/summary?days=7", { headers: AUTH })
    expect(response.status()).toBe(200)

    const body = analyticsSummarySchema.parse(await jsonBody(response))
    expect(body.summary.days).toBe(7)
    expect(body.summary.totals.events).toBeGreaterThanOrEqual(0)
    expect(Array.isArray(body.summary.daily)).toBe(true)
  })

  test("GET /api/analytics/summary rejects an out-of-range days param", async ({ request }) => {
    const response = await request.get("/api/analytics/summary?days=999", { headers: AUTH })
    expect(response.status()).toBe(400)
    const body = authFailSchema.parse(await jsonBody(response))
    expect(body.code).toBe("invalid_days")
  })
})

test.describe("POST /api/notifications + SSE stream", () => {
  test("publishes a stream event", async ({ request }) => {
    const response = await request.post("/api/notifications", {
      headers: AUTH,
      data: { type: "read_all" },
    })
    expect(response.status()).toBe(200)
    publishOkSchema.parse(await jsonBody(response))
  })

  test("rejects an unsupported event shape", async ({ request }) => {
    const response = await request.post("/api/notifications", {
      headers: AUTH,
      data: { type: "not-a-real-event" },
    })
    expect(response.status()).toBe(400)
    const body = authFailSchema.parse(await jsonBody(response))
    expect(body.code).toBe("invalid_event")
  })

  test("GET /api/notifications/stream opens an SSE feed", async ({ request }) => {
    const origin = await apiOrigin(request)
    const stream = await readFirstSseChunk(`${origin}/api/notifications/stream`, {
      cookie: mockSessionCookieHeader(MOCK_EMAIL),
    })
    expect(stream.status).toBe(200)
    expect(stream.contentType).toContain("text/event-stream")
    expect(stream.chunk).toContain(": connected")
  })
})

test.describe("POST /api/activity + SSE stream", () => {
  const ACTIVITY_EVENT = {
    type: "activity",
    activity: {
      id: `contract-${Date.now()}`,
      kind: "system",
      summary: "Contract test activity",
      createdAt: new Date().toISOString(),
      actor: { id: "contract", name: "Contract User" },
    },
  }

  test("publishes an activity event", async ({ request }) => {
    const response = await request.post("/api/activity", {
      headers: AUTH,
      data: ACTIVITY_EVENT,
    })
    expect(response.status()).toBe(200)
    publishOkSchema.parse(await jsonBody(response))
  })

  test("rejects an unsupported event shape", async ({ request }) => {
    const response = await request.post("/api/activity", {
      headers: AUTH,
      data: { type: "activity", activity: { id: "x" } },
    })
    expect(response.status()).toBe(400)
    const body = authFailSchema.parse(await jsonBody(response))
    expect(body.code).toBe("invalid_event")
  })

  test("GET /api/activity/stream opens an SSE feed", async ({ request }) => {
    const origin = await apiOrigin(request)
    const stream = await readFirstSseChunk(`${origin}/api/activity/stream`, {
      cookie: mockSessionCookieHeader(MOCK_EMAIL),
    })
    expect(stream.status).toBe(200)
    expect(stream.contentType).toContain("text/event-stream")
    expect(stream.chunk).toContain(": connected")
  })
})

test.describe("POST /api/notifications/digest", () => {
  test("answers the digest delivery contract", async ({ request }) => {
    const response = await request.post("/api/notifications/digest", {
      headers: AUTH,
      data: {
        frequency: "daily",
        notifications: [],
        // Empty preferences sanitize to email:false → deterministic "disabled".
        preferences: {},
      },
    })
    expect(response.status()).toBe(200)

    const body = digestResultSchema.parse(await jsonBody(response))
    expect(body.delivery).toBe("disabled")
    expect(body.itemCount).toBe(0)
  })

  test("rejects a malformed payload", async ({ request }) => {
    const response = await request.post("/api/notifications/digest", {
      headers: AUTH,
      data: { frequency: "hourly" },
    })
    expect(response.status()).toBe(400)
    authFailSchema.parse(await jsonBody(response))
  })
})
