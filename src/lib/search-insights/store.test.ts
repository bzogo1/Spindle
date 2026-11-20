import { beforeEach, describe, expect, it, vi } from "vitest"

import { SEARCH_EVENTS_SCHEMA_VERSION, type SearchEvent } from "./schema"
import {
  appendAndQueueEvents,
  appendSearchEvent,
  appendSearchEvents,
  clearSearchEvents,
  flushEvents,
  migrateStoredEvents,
  onFlush,
  readStoredEvents,
  resetFlushQueueForTests,
  SEARCH_EVENTS_STORAGE_KEY,
} from "./store"

function event(query: string, ts = 1): SearchEvent {
  return {
    schemaVersion: SEARCH_EVENTS_SCHEMA_VERSION,
    ts,
    type: "query_submitted",
    query,
    resultCount: 2,
  }
}

describe("search events store", () => {
  beforeEach(() => {
    window.localStorage.clear()
    resetFlushQueueForTests()
  })

  it("appends and reads events", () => {
    expect(appendSearchEvent(event("deploy"))).toBe(true)
    expect(appendSearchEvent(event("api"))).toBe(true)
    const stored = readStoredEvents()
    expect(stored).toHaveLength(2)
    expect(stored.map((e) => (e.type === "query_submitted" ? e.query : ""))).toEqual([
      "deploy",
      "api",
    ])
  })

  it("drops invalid events", () => {
    expect(appendSearchEvents([{ bogus: true } as unknown as SearchEvent])).toBe(0)
    expect(readStoredEvents()).toHaveLength(0)
  })

  it("evicts oldest events beyond the ring buffer cap", () => {
    const batch = Array.from({ length: 5 }, (_, i) => event(`q${i}`, i))
    // Temporarily shrink via direct storage write to test the slice logic
    // without writing 1000 events.
    window.localStorage.setItem(
      SEARCH_EVENTS_STORAGE_KEY,
      JSON.stringify({
        version: SEARCH_EVENTS_SCHEMA_VERSION,
        events: Array.from({ length: 999 }, (_, i) => event(`old${i}`, i)),
      }),
    )
    appendSearchEvents(batch)
    const stored = readStoredEvents()
    expect(stored).toHaveLength(1000)
    expect(stored[0]).toMatchObject({ query: "old4" })
    expect(stored[stored.length - 1]).toMatchObject({ query: "q4" })
  })

  it("migrates payloads from other schema versions", () => {
    const migrated = migrateStoredEvents({
      version: 0,
      events: [event("keep"), { type: "nope" }, "junk"],
    })
    expect(migrated.version).toBe(SEARCH_EVENTS_SCHEMA_VERSION)
    expect(migrated.events).toHaveLength(1)
    expect(migrated.events[0]).toMatchObject({ query: "keep" })
  })

  it("returns empty on corrupt JSON", () => {
    window.localStorage.setItem(SEARCH_EVENTS_STORAGE_KEY, "{not json")
    expect(readStoredEvents()).toEqual([])
  })

  it("clearSearchEvents empties the buffer", () => {
    appendSearchEvent(event("x"))
    clearSearchEvents()
    expect(readStoredEvents()).toHaveLength(0)
  })

  it("notifies flush listeners with appended batches", () => {
    const listener = vi.fn()
    const unsubscribe = onFlush(listener)
    appendSearchEvent(event("a"))
    appendSearchEvent(event("b"))
    expect(flushEvents()).toBe(2)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith([
      expect.objectContaining({ query: "a" }),
      expect.objectContaining({ query: "b" }),
    ])
    // Second flush has nothing pending.
    expect(flushEvents()).toBe(0)
    unsubscribe()
  })

  it("appendAndQueueEvents flushes immediately", () => {
    const listener = vi.fn()
    onFlush(listener)
    appendAndQueueEvents([event("z")])
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it("caps the pending flush queue at MAX_STORED_EVENTS", () => {
    const batch = Array.from({ length: 1001 }, (_, i) => event(`bulk${i}`, i))
    appendSearchEvents(batch)
    expect(flushEvents()).toBe(1000)
  })

  it("survives a throwing flush listener", () => {
    onFlush(() => {
      throw new Error("transport down")
    })
    const good = vi.fn()
    onFlush(good)
    appendSearchEvent(event("ok"))
    expect(() => flushEvents()).not.toThrow()
    expect(good).toHaveBeenCalled()
  })
})
