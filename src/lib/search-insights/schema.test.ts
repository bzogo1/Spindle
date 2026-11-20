import { describe, expect, it } from "vitest"

import {
  asSearchEvent,
  SEARCH_EVENTS_SCHEMA_VERSION,
  validateSearchEvent,
  type QuerySubmittedEvent,
} from "./schema"

function base() {
  return { schemaVersion: SEARCH_EVENTS_SCHEMA_VERSION, ts: 1700000000000 }
}

describe("validateSearchEvent", () => {
  it("accepts a well-formed query_submitted event", () => {
    const event: QuerySubmittedEvent = {
      ...base(),
      type: "query_submitted",
      query: "deploy",
      resultCount: 3,
      latencyMs: 12,
      itemCount: 100,
      cacheHit: true,
      locale: "en",
      anonId: "anon-1",
    }
    expect(validateSearchEvent(event)).toBe(true)
    expect(asSearchEvent(event)).toEqual(event)
  })

  it("rejects non-objects and missing base fields", () => {
    expect(validateSearchEvent(null)).toBe(false)
    expect(validateSearchEvent("x")).toBe(false)
    expect(validateSearchEvent({ type: "query_submitted", query: "x", resultCount: 1 })).toBe(false)
  })

  it("rejects unknown event types", () => {
    expect(validateSearchEvent({ ...base(), type: "bogus", query: "x" })).toBe(false)
  })

  it("rejects query_submitted with negative resultCount", () => {
    expect(
      validateSearchEvent({ ...base(), type: "query_submitted", query: "x", resultCount: -1 }),
    ).toBe(false)
  })

  it("requires a known source for suggestion_used", () => {
    expect(
      validateSearchEvent({
        ...base(),
        type: "suggestion_used",
        query: "api",
        suggestion: "endpoint",
        source: "bogus",
      }),
    ).toBe(false)
    expect(
      validateSearchEvent({
        ...base(),
        type: "suggestion_used",
        query: "api",
        suggestion: "endpoint",
        source: "related",
      }),
    ).toBe(true)
  })

  it("validates experiment events", () => {
    expect(
      validateSearchEvent({
        ...base(),
        type: "experiment_exposure",
        experiment: "exp-1",
        variant: "control",
      }),
    ).toBe(true)
    expect(
      validateSearchEvent({
        ...base(),
        type: "experiment_conversion",
        experiment: "exp-1",
        variant: "control",
      }),
    ).toBe(false)
    expect(
      validateSearchEvent({
        ...base(),
        type: "experiment_conversion",
        experiment: "exp-1",
        variant: "control",
        conversion: "result_clicked",
      }),
    ).toBe(true)
  })
})
