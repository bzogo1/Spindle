import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  getAnalyticsSummary,
  parseAnalyticsEventsPayload,
  recordAnalyticsEvents,
  resetAnalyticsStoreForTests,
  trackApiCall,
  trackEvent,
  trackFeatureUse,
  trackPageView,
} from "@/lib/analytics"
import type { AnalyticsEventInput } from "@/lib/analytics"
import {
  CONSENT_COOKIE,
  acceptAllChoices,
  clearConsent,
  essentialOnlyChoices,
  writeConsent,
} from "@/lib/consent"

function resetConsentCookie() {
  document.cookie = `${CONSENT_COOKIE}=; Path=/; Max-Age=0`
}

let debugSpy: ReturnType<typeof vi.spyOn>
let fetchSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  resetConsentCookie()
  resetAnalyticsStoreForTests()
  debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {})
  fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"))
})

afterEach(() => {
  resetConsentCookie()
  debugSpy.mockRestore()
  fetchSpy.mockRestore()
})

describe("trackEvent", () => {
  it("ignores empty and over-long event names", () => {
    writeConsent(acceptAllChoices())

    trackEvent("")
    trackEvent("x".repeat(200))

    expect(debugSpy).not.toHaveBeenCalled()
  })

  it("queues events while consent is undecided, then drops them on rejection", () => {
    trackEvent("signup_started", { source: "banner" })
    trackPageView("/pricing")

    // Nothing emitted before a decision.
    expect(debugSpy).not.toHaveBeenCalled()

    writeConsent(essentialOnlyChoices())

    // The rejection discards the queue instead of flushing it.
    expect(debugSpy).not.toHaveBeenCalled()
  })

  it("drops events once analytics consent is decided off", () => {
    writeConsent(essentialOnlyChoices())

    trackEvent("feature_used", { feature: "search" })
    trackPageView("/docs")

    expect(debugSpy).not.toHaveBeenCalled()
  })

  it("flushes queued events when analytics consent is granted", () => {
    trackEvent("signup_started", { source: "banner" })
    trackPageView("/pricing")

    writeConsent(acceptAllChoices())

    expect(debugSpy).toHaveBeenCalledTimes(2)
    expect(debugSpy).toHaveBeenCalledWith(
      "[analytics]",
      "signup_started",
      expect.objectContaining({ source: "banner" }),
    )
    expect(debugSpy).toHaveBeenCalledWith(
      "[analytics]",
      "page_view",
      expect.objectContaining({ path: "/pricing" }),
    )
  })

  it("emits immediately once analytics consent is granted", () => {
    writeConsent(acceptAllChoices())
    debugSpy.mockClear()

    trackEvent("cta_clicked", { cta: "hero" })

    expect(debugSpy).toHaveBeenCalledTimes(1)
    expect(debugSpy).toHaveBeenCalledWith(
      "[analytics]",
      "cta_clicked",
      expect.objectContaining({ cta: "hero" }),
    )
  })

  it("can queue again after the visitor clears their choice", () => {
    writeConsent(essentialOnlyChoices())
    clearConsent()

    trackEvent("returning_visit")
    expect(debugSpy).not.toHaveBeenCalled()

    writeConsent(acceptAllChoices())
    expect(debugSpy).toHaveBeenCalledWith("[analytics]", "returning_visit", expect.anything())
  })

  it("ships consented events to /api/analytics as a batched POST", () => {
    writeConsent(acceptAllChoices())
    fetchSpy.mockClear()

    trackPageView("/docs/guide")
    trackFeatureUse("search", { query: "docs" })
    trackApiCall("/api/projects", { method: "GET" })

    expect(fetchSpy).toHaveBeenCalledTimes(3)
    const [url, init] = fetchSpy.mock.calls[0]
    expect(String(url)).toBe(`${window.location.origin}/api/analytics`)
    expect(init?.method).toBe("POST")

    const body = JSON.parse(String(fetchSpy.mock.calls[0][1]?.body)) as {
      events: {
        type: string
        name: string
        path?: string
        feature?: string
        anonymousId?: string
      }[]
    }
    expect(body.events[0]).toMatchObject({ type: "page_view", path: "/docs/guide" })
    expect(typeof body.events[0].anonymousId).toBe("string")

    const featureBody = JSON.parse(String(fetchSpy.mock.calls[1][1]?.body)) as {
      events: { type: string; name: string; feature?: string }[]
    }
    expect(featureBody.events[0]).toMatchObject({
      type: "feature_use",
      name: "search",
      feature: "search",
    })

    const apiBody = JSON.parse(String(fetchSpy.mock.calls[2][1]?.body)) as {
      events: { type: string; name: string; endpoint?: string }[]
    }
    expect(apiBody.events[0]).toMatchObject({
      type: "api_call",
      name: "/api/projects",
    })
  })

  it("does not POST while consent is undecided or rejected", () => {
    trackEvent("queued_event")
    writeConsent(essentialOnlyChoices())
    trackEvent("rejected_event")

    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("flushes the pre-consent queue as one POST when analytics is granted", () => {
    trackEvent("early_event")
    trackPageView("/pricing")
    expect(fetchSpy).not.toHaveBeenCalled()

    writeConsent(acceptAllChoices())

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const body = JSON.parse(String(fetchSpy.mock.calls[0][1]?.body)) as {
      events: { type: string; name: string }[]
    }
    expect(body.events.map((e) => e.name)).toEqual(["early_event", "page_view"])
  })

  it("swallows ingest network failures", async () => {
    writeConsent(acceptAllChoices())
    fetchSpy.mockClear()
    fetchSpy.mockRejectedValue(new Error("offline"))

    expect(() => trackEvent("safe_event")).not.toThrow()
    await Promise.resolve()
    await Promise.resolve()
  })
})

function inputEvent(overrides: Partial<AnalyticsEventInput> = {}): AnalyticsEventInput {
  return {
    type: "page_view",
    name: "page_view",
    path: "/app",
    feature: null,
    endpoint: null,
    props: {},
    timestamp: 1_000,
    anonymousId: "anon-1",
    ...overrides,
  }
}

describe("parseAnalyticsEventsPayload", () => {
  const now = 1_700_000_000_000

  it("rejects non-object bodies and missing/empty/oversized event arrays", () => {
    expect(parseAnalyticsEventsPayload(null, now)).toBeNull()
    expect(parseAnalyticsEventsPayload("nope", now)).toBeNull()
    expect(parseAnalyticsEventsPayload({}, now)).toBeNull()
    expect(parseAnalyticsEventsPayload({ events: [] }, now)).toBeNull()
    expect(
      parseAnalyticsEventsPayload({ events: new Array(21).fill(inputEvent()) }, now),
    ).toBeNull()
  })

  it("rejects unknown event types and malformed fields", () => {
    expect(
      parseAnalyticsEventsPayload({ events: [{ ...inputEvent(), type: "click" }] }, now),
    ).toBeNull()
    expect(parseAnalyticsEventsPayload({ events: [{ ...inputEvent(), name: 42 }] }, now)).toBeNull()
    expect(
      parseAnalyticsEventsPayload({ events: [{ ...inputEvent(), props: ["x"] }] }, now),
    ).toBeNull()
    expect(
      parseAnalyticsEventsPayload({ events: [{ ...inputEvent(), timestamp: "soon" }] }, now),
    ).toBeNull()
  })

  it("rejects oversized props payloads", () => {
    const big = { blob: "x".repeat(5_000) }
    expect(
      parseAnalyticsEventsPayload({ events: [{ ...inputEvent(), props: big }] }, now),
    ).toBeNull()
  })

  it("defaults the name to the type and clamps timestamps into a sane window", () => {
    const parsed = parseAnalyticsEventsPayload(
      {
        events: [
          { type: "feature_use" },
          { ...inputEvent(), timestamp: now - 30 * 24 * 60 * 60 * 1000 },
          { ...inputEvent(), timestamp: now + 60 * 60 * 1000 },
        ],
      },
      now,
    )

    expect(parsed).not.toBeNull()
    expect(parsed![0].name).toBe("feature_use")
    expect(parsed![0].timestamp).toBe(now)
    // Older than 7 days → clamped to the window edge.
    expect(parsed![1].timestamp).toBe(now - 7 * 24 * 60 * 60 * 1000)
    // More than 10 minutes in the future → clamped to now + skew.
    expect(parsed![2].timestamp).toBe(now + 10 * 60 * 1000)
  })
})

describe("recordAnalyticsEvents + getAnalyticsSummary", () => {
  const now = Date.UTC(2026, 5, 15, 12, 0, 0) // 2026-06-15T12:00Z

  function seed() {
    const events = [
      inputEvent({ type: "page_view", path: "/app", timestamp: now - 60_000 }),
      inputEvent({ type: "page_view", path: "/app", timestamp: now - 30_000 }),
      inputEvent({ type: "page_view", path: "/docs", timestamp: now - 20_000 }),
      inputEvent({
        type: "feature_use",
        name: "search",
        feature: "search",
        path: "/app",
        timestamp: now - 10_000,
      }),
      inputEvent({
        type: "api_call",
        name: "/api/projects",
        endpoint: "/api/projects",
        path: null,
        timestamp: now - 5_000,
      }),
      // Outside the 7-day window.
      inputEvent({ type: "page_view", path: "/old", timestamp: now - 10 * 24 * 60 * 60 * 1000 }),
    ]
    recordAnalyticsEvents(events, { userId: "user:u1", now })
    recordAnalyticsEvents([inputEvent({ type: "page_view", path: "/other", timestamp: now })], {
      userId: "user:u2",
      now,
    })
  }

  it("aggregates totals, daily buckets, top events, and top paths", () => {
    seed()
    const summary = getAnalyticsSummary({ days: 7, userId: "user:u1", now })

    expect(summary.days).toBe(7)
    expect(summary.totals).toEqual({ events: 5, pageViews: 3, featureUses: 1, apiCalls: 1 })
    expect(summary.daily).toHaveLength(7)
    expect(summary.daily.at(-1)).toMatchObject({
      date: "2026-06-15",
      events: 5,
      pageViews: 3,
      featureUses: 1,
      apiCalls: 1,
    })
    expect(summary.daily[0].date).toBe("2026-06-09")

    expect(summary.topEvents[0]).toMatchObject({ name: "page_view", count: 3 })
    expect(summary.topPaths[0]).toMatchObject({ path: "/app", count: 3 })
    expect(summary.topPaths.map((p) => p.path)).toContain("/docs")
    expect(summary.topPaths.map((p) => p.path)).not.toContain("/old")
  })

  it("scopes results to the given principal and supports a global aggregate", () => {
    seed()

    const u2 = getAnalyticsSummary({ days: 7, userId: "user:u2", now })
    expect(u2.totals.events).toBe(1)

    const all = getAnalyticsSummary({ days: 7, userId: null, now })
    expect(all.totals.events).toBe(6)
  })

  it("clamps the days parameter", () => {
    seed()
    expect(getAnalyticsSummary({ days: 0, userId: "user:u1", now }).days).toBe(1)
    expect(getAnalyticsSummary({ days: 365, userId: "user:u1", now }).days).toBe(90)
    // 1-day window still sees today's events.
    const one = getAnalyticsSummary({ days: 1, userId: "user:u1", now })
    expect(one.daily).toHaveLength(1)
    expect(one.totals.events).toBe(5)
  })

  it("returns zeroed aggregates for an empty store", () => {
    const summary = getAnalyticsSummary({ days: 30, userId: "user:nobody", now })
    expect(summary.totals.events).toBe(0)
    expect(summary.daily).toHaveLength(30)
    expect(summary.topEvents).toEqual([])
    expect(summary.topPaths).toEqual([])
  })
})
