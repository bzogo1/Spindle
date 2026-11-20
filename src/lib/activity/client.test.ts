import { describe, expect, it } from "vitest"

import type { ActivityEvent } from "../api/types"
import { isActivityEvent, mergeActivityEvents } from "./client"

function event(id: string, createdAt: string, projectId = "prj_01"): ActivityEvent {
  return {
    id,
    projectId,
    kind: "file",
    actor: { id: "user-1", name: "Bogdan" },
    summary: `event ${id}`,
    createdAt,
  }
}

describe("mergeActivityEvents", () => {
  it("returns live events ahead of fetched events, newest first", () => {
    const merged = mergeActivityEvents(
      [event("act_01", "2026-11-19T10:00:00.000Z"), event("act_02", "2026-11-19T09:00:00.000Z")],
      [event("act_live", "2026-11-19T11:00:00.000Z")],
    )
    expect(merged.map((item) => item.id)).toEqual(["act_live", "act_01", "act_02"])
  })

  it("dedupes by id so a refetched event is not shown twice", () => {
    const live = event("act_01", "2026-11-19T10:00:00.000Z")
    const merged = mergeActivityEvents([event("act_01", "2026-11-19T10:00:00.000Z")], [live])
    expect(merged).toHaveLength(1)
    expect(merged[0]).toBe(live)
  })

  it("sorts by createdAt descending regardless of input order", () => {
    const merged = mergeActivityEvents(
      [event("act_old", "2026-11-18T10:00:00.000Z")],
      [event("act_new", "2026-11-20T10:00:00.000Z")],
    )
    expect(merged.map((item) => item.id)).toEqual(["act_new", "act_old"])
  })

  it("handles empty inputs", () => {
    expect(mergeActivityEvents([], [])).toEqual([])
    expect(mergeActivityEvents([event("a", "2026-11-19T10:00:00.000Z")], [])).toHaveLength(1)
  })
})

describe("isActivityEvent re-export", () => {
  it("validates activity payloads", () => {
    expect(isActivityEvent(event("act_01", "2026-11-19T10:00:00.000Z"))).toBe(true)
    expect(isActivityEvent({ id: "x" })).toBe(false)
  })
})
