import { beforeEach, describe, expect, it } from "vitest"

import {
  createDwellTracker,
  createQueryLifecycle,
  resultClickedInputFromHit,
  trackDocOpened,
  trackExperimentConversion,
  trackExperimentExposure,
  trackFeedbackSubmitted,
  trackQuerySubmitted,
  trackResultClicked,
  trackResultDwell,
  trackSearchPerformance,
  trackSuggestionUsed,
  trackZeroResults,
} from "./tracker"
import { readStoredEvents, resetFlushQueueForTests } from "./store"
import type { SearchHit } from "@/lib/search"

describe("search tracker", () => {
  beforeEach(() => {
    window.localStorage.clear()
    resetFlushQueueForTests()
  })

  it("records query_submitted with context", () => {
    trackQuerySubmitted(
      { query: "  deploy  ", resultCount: 4, latencyMs: 9, itemCount: 50, cacheHit: true },
      { locale: "uk", anonId: "a1" },
    )
    const [event] = readStoredEvents()
    expect(event).toMatchObject({
      type: "query_submitted",
      query: "deploy",
      resultCount: 4,
      latencyMs: 9,
      itemCount: 50,
      cacheHit: true,
      locale: "uk",
      anonId: "a1",
    })
    expect(event?.schemaVersion).toBeGreaterThan(0)
    expect(event?.ts).toBeGreaterThan(0)
  })

  it("clamps negative result counts", () => {
    trackQuerySubmitted({ query: "x", resultCount: -3 })
    const [event] = readStoredEvents()
    expect(event).toMatchObject({ resultCount: 0 })
  })

  it("records result_clicked", () => {
    trackResultClicked({
      query: "api",
      itemId: "doc:guide:api",
      itemTitle: "API guide",
      position: 2,
      itemType: "doc",
      href: "/docs/api",
    })
    expect(readStoredEvents()[0]).toMatchObject({
      type: "result_clicked",
      itemId: "doc:guide:api",
      position: 2,
    })
  })

  it("builds click input from a SearchHit", () => {
    const hit = {
      item: {
        id: "page:/app",
        title: "App",
        group: "Pages",
        type: "page",
        href: "/app",
      },
      score: 1,
    } as SearchHit
    const input = resultClickedInputFromHit("app", hit, 0)
    expect(input).toMatchObject({
      query: "app",
      itemId: "page:/app",
      itemTitle: "App",
      itemType: "page",
      href: "/app",
    })
  })

  it("clamps dwell time", () => {
    trackResultDwell({ query: "q", itemId: "i", dwellMs: 999_999_999 })
    const [event] = readStoredEvents()
    expect(event).toMatchObject({ type: "result_dwell", dwellMs: 600_000 })
  })

  it("records zero_results, suggestion_used, perf, conversions", () => {
    trackZeroResults("nothing")
    trackSuggestionUsed({ query: "ap", suggestion: "api", source: "related" })
    trackSearchPerformance({ latencyMs: 5, itemCount: 10, cacheHit: false })
    trackDocOpened({ query: "api", href: "/docs/api" })
    trackFeedbackSubmitted({ query: "api", source: "command-menu" })
    trackExperimentExposure("exp", "control")
    trackExperimentConversion("exp", "control", "result_clicked")

    const types = readStoredEvents().map((e) => e.type)
    expect(types).toEqual([
      "zero_results",
      "suggestion_used",
      "search_performance",
      "doc_opened",
      "feedback_submitted",
      "experiment_exposure",
      "experiment_conversion",
    ])
  })

  it("dwell tracker records elapsed time on stop", () => {
    const tracker = createDwellTracker({ locale: "en" })
    tracker.start("deploy", "item-1")
    const ok = tracker.stop()
    expect(ok).toBe(true)
    const [event] = readStoredEvents()
    expect(event).toMatchObject({ type: "result_dwell", itemId: "item-1" })
    expect((event as { dwellMs: number }).dwellMs).toBeGreaterThanOrEqual(0)
  })

  it("dwell tracker stop without start is a no-op", () => {
    const tracker = createDwellTracker()
    expect(tracker.stop()).toBe(false)
    expect(readStoredEvents()).toHaveLength(0)
  })

  it("cancel discards the measurement", () => {
    const tracker = createDwellTracker()
    tracker.start("q", "i")
    tracker.cancel()
    expect(tracker.stop()).toBe(false)
  })

  it("query lifecycle records submissions", () => {
    const lifecycle = createQueryLifecycle({ locale: "en" })
    lifecycle.submitted({ query: "test", resultCount: 0 })
    const [event] = readStoredEvents()
    expect(event).toMatchObject({ type: "query_submitted", resultCount: 0 })
  })

  it("uses detected locale and generated anon id by default", () => {
    trackQuerySubmitted({ query: "x", resultCount: 1 })
    const [event] = readStoredEvents()
    expect(event?.locale).toBeTruthy()
    expect(event?.anonId).toBeTruthy()
  })
})
