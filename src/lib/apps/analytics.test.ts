import { beforeEach, describe, expect, it } from "vitest"

import {
  aggregateStats,
  analyticsStorageKey,
  clearAppAnalytics,
  getAppStats,
  initAppAnalytics,
  type AppAnalyticsEvent,
} from "./analytics"

describe("aggregateStats", () => {
  it("counts events per name and tracks first/last timestamps", () => {
    const events: AppAnalyticsEvent[] = [
      { name: "open", timestamp: 300 },
      { name: "click", timestamp: 100 },
      { name: "open", timestamp: 200 },
    ]
    const stats = aggregateStats("app", events)
    expect(stats.totalEvents).toBe(3)
    expect(stats.eventsByName).toEqual({ open: 2, click: 1 })
    expect(stats.firstEventAt).toBe(100)
    expect(stats.lastEventAt).toBe(300)
    expect(stats.appId).toBe("app")
  })

  it("handles empty input", () => {
    const stats = aggregateStats("app", [])
    expect(stats.totalEvents).toBe(0)
    expect(stats.firstEventAt).toBeNull()
    expect(stats.lastEventAt).toBeNull()
    expect(stats.eventsByName).toEqual({})
  })
})

describe("initAppAnalytics", () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it("tracks events and persists them", () => {
    const client = initAppAnalytics("demo-app")
    client.track("app_open", { source: "portal" })
    client.track("button_click")

    const stored = JSON.parse(window.localStorage.getItem(analyticsStorageKey("demo-app"))!)
    expect(stored).toHaveLength(2)
    expect(stored[0].name).toBe("app_open")
    expect(stored[0].properties).toEqual({ source: "portal" })
    expect(typeof stored[0].timestamp).toBe("number")
  })

  it("aggregates stats across tracked events", () => {
    const client = initAppAnalytics("stats-app")
    client.track("a")
    client.track("b")
    client.track("a")

    const stats = client.getStats()
    expect(stats.totalEvents).toBe(3)
    expect(stats.eventsByName).toEqual({ a: 2, b: 1 })
  })

  it("isolates apps by id", () => {
    initAppAnalytics("one").track("x")
    initAppAnalytics("two").track("y")
    expect(getAppStats("one").totalEvents).toBe(1)
    expect(getAppStats("two").eventsByName).toEqual({ y: 1 })
  })

  it("caps stored events at 1000", () => {
    const memory = new Map<string, string>()
    const fakeStorage = {
      getItem: (k: string) => memory.get(k) ?? null,
      setItem: (k: string, v: string) => void memory.set(k, v),
      removeItem: (k: string) => void memory.delete(k),
      clear: () => memory.clear(),
      key: () => null,
      length: 0,
    } as Storage

    const client = initAppAnalytics("big", fakeStorage)
    for (let i = 0; i < 1005; i++) client.track("evt", { i })
    expect(client.listEvents()).toHaveLength(1000)
    expect(client.listEvents()[0].properties).toEqual({ i: 5 })
  })

  it("clears analytics", () => {
    const client = initAppAnalytics("wipe")
    client.track("x")
    clearAppAnalytics("wipe")
    expect(getAppStats("wipe").totalEvents).toBe(0)
    expect(window.localStorage.getItem(analyticsStorageKey("wipe"))).toBeNull()
  })

  it("ignores corrupt stored data", () => {
    window.localStorage.setItem(analyticsStorageKey("bad"), "{oops")
    expect(getAppStats("bad").totalEvents).toBe(0)
    window.localStorage.setItem(analyticsStorageKey("bad"), JSON.stringify({ nope: 1 }))
    expect(getAppStats("bad").totalEvents).toBe(0)
  })

  it("filters malformed events out of stored arrays", () => {
    window.localStorage.setItem(
      analyticsStorageKey("mixed"),
      JSON.stringify([{ name: "ok", timestamp: 1 }, { name: 42 }, "junk", null]),
    )
    expect(getAppStats("mixed").totalEvents).toBe(1)
  })
})
