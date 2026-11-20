import { describe, expect, it } from "vitest"

import type { ActivityEvent } from "../api/types"
import { isActivityEvent, isActivityStreamEvent } from "./events"

const activity: ActivityEvent = {
  id: "act_01",
  projectId: "prj_01",
  projectName: "Coastal Resilience",
  kind: "agent",
  actor: { id: "user-1", name: "Bogdan" },
  summary: "started an agent run",
  target: "Draft the methods section",
  createdAt: "2026-11-19T11:45:00.000Z",
}

describe("isActivityEvent", () => {
  it("accepts a well-formed activity event", () => {
    expect(isActivityEvent(activity)).toBe(true)
  })

  it("accepts an event without optional fields", () => {
    expect(
      isActivityEvent({
        id: "act_02",
        kind: "system",
        actor: { id: "user-1", name: "Bogdan" },
        summary: "storage warning threshold changed",
        createdAt: "2026-10-28T10:00:00.000Z",
      }),
    ).toBe(true)
  })

  it("rejects malformed payloads", () => {
    expect(isActivityEvent(null)).toBe(false)
    expect(isActivityEvent("act_01")).toBe(false)
    expect(isActivityEvent({ ...activity, id: "" })).toBe(false)
    expect(isActivityEvent({ ...activity, kind: "bogus" })).toBe(false)
    expect(isActivityEvent({ ...activity, summary: "" })).toBe(false)
    expect(isActivityEvent({ ...activity, createdAt: 42 })).toBe(false)
    expect(isActivityEvent({ ...activity, actor: { id: "u" } })).toBe(false)
    expect(isActivityEvent({ ...activity, actor: null })).toBe(false)
  })
})

describe("isActivityStreamEvent", () => {
  it("accepts an activity stream event", () => {
    expect(isActivityStreamEvent({ type: "activity", activity })).toBe(true)
  })

  it("rejects malformed payloads", () => {
    expect(isActivityStreamEvent(null)).toBe(false)
    expect(isActivityStreamEvent({ type: "activity" })).toBe(false)
    expect(isActivityStreamEvent({ type: "activity", activity: { id: "x" } })).toBe(false)
    expect(isActivityStreamEvent({ type: "bogus", activity })).toBe(false)
    expect(isActivityStreamEvent(activity)).toBe(false)
  })
})
