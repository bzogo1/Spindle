import { beforeEach, describe, expect, it } from "vitest"

import { recordAnalyticsEvents, resetAnalyticsStoreForTests } from "@/lib/analytics"
import type { AnalyticsEventInput } from "@/lib/analytics"
import { createAccessToken } from "@/lib/auth/token-codec"

import { GET } from "./route"

const UID = "user-analytics-summary"
const OTHER_UID = "user-analytics-other"

function authCookie(uid = UID) {
  const { token } = createAccessToken({
    sid: "sid-1",
    uid,
    email: `${uid}@b.c`,
    name: "A",
  })
  return `spindle_at=${token}`
}

function get(query = "", cookie?: string) {
  return GET(
    new Request(`http://localhost/api/analytics/summary${query}`, {
      headers: cookie ? { cookie } : {},
    }),
  )
}

function event(overrides: Partial<AnalyticsEventInput> = {}): AnalyticsEventInput {
  return {
    type: "page_view",
    name: "page_view",
    path: "/app",
    feature: null,
    endpoint: null,
    props: {},
    timestamp: Date.now(),
    anonymousId: "anon-test",
    ...overrides,
  }
}

beforeEach(() => {
  resetAnalyticsStoreForTests()
})

describe("GET /api/analytics/summary", () => {
  it("rejects unauthenticated requests", async () => {
    const response = await get()
    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ ok: false, code: "unauthenticated" })
  })

  it("rejects invalid days parameters", async () => {
    const cookie = authCookie()
    expect((await get("?days=abc", cookie)).status).toBe(400)
    expect((await get("?days=0", cookie)).status).toBe(400)
    expect((await get("?days=999", cookie)).status).toBe(400)
  })

  it("returns an empty summary for a signed-in user with no events", async () => {
    const response = await get("?days=7", authCookie())
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.summary.days).toBe(7)
    expect(body.summary.totals.events).toBe(0)
    expect(body.summary.daily).toHaveLength(7)
    expect(body.summary.topEvents).toEqual([])
  })

  it("aggregates only the caller's own events", async () => {
    recordAnalyticsEvents(
      [
        event(),
        event({ type: "feature_use", name: "search", feature: "search" }),
        event({ type: "api_call", name: "/api/projects", endpoint: "/api/projects" }),
      ],
      { userId: `user:${UID}` },
    )
    recordAnalyticsEvents([event()], { userId: `user:${OTHER_UID}` })
    // Anonymous events are stored but never attributed to a principal.
    recordAnalyticsEvents([event()], { userId: null })

    const response = await get("?days=30", authCookie())
    expect(response.status).toBe(200)
    const { summary } = await response.json()

    expect(summary.totals).toEqual({ events: 3, pageViews: 1, featureUses: 1, apiCalls: 1 })
    expect(summary.topEvents.map((e: { name: string }) => e.name).sort()).toEqual([
      "/api/projects",
      "page_view",
      "search",
    ])
    expect(summary.topPaths).toEqual([{ path: "/app", count: 3 }])

    const other = await get("?days=30", authCookie(OTHER_UID))
    const otherBody = await other.json()
    expect(otherBody.summary.totals.events).toBe(1)
  })
})
