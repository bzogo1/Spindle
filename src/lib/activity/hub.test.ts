import { beforeEach, describe, expect, it, vi } from "vitest"

import { publishActivityEvent, resetActivityHubForTests, subscribeActivityEvents } from "./hub"
import type { ActivityStreamEvent } from "./events"

const event: ActivityStreamEvent = {
  type: "activity",
  activity: {
    id: "act_live_1",
    projectId: "prj_01",
    kind: "chat",
    actor: { id: "user-1", name: "Bogdan" },
    summary: "sent a message",
    createdAt: "2026-11-19T12:00:00.000Z",
  },
}

beforeEach(() => {
  resetActivityHubForTests()
})

describe("activity hub", () => {
  it("delivers published events to subscribers of the same principal", () => {
    const listener = vi.fn()
    subscribeActivityEvents("user:1", listener)

    publishActivityEvent("user:1", event)
    expect(listener).toHaveBeenCalledWith(event)
  })

  it("does not deliver across principals", () => {
    const listener = vi.fn()
    subscribeActivityEvents("user:1", listener)

    publishActivityEvent("user:2", event)
    expect(listener).not.toHaveBeenCalled()
  })

  it("stops delivering after unsubscribe and tolerates double unsubscribe", () => {
    const listener = vi.fn()
    const unsubscribe = subscribeActivityEvents("user:1", listener)

    unsubscribe()
    unsubscribe()
    publishActivityEvent("user:1", event)
    expect(listener).not.toHaveBeenCalled()
  })

  it("isolates throwing listeners from the rest of the fan-out", () => {
    const bad = vi.fn(() => {
      throw new Error("boom")
    })
    const good = vi.fn()
    subscribeActivityEvents("user:1", bad)
    subscribeActivityEvents("user:1", good)

    expect(() => publishActivityEvent("user:1", event)).not.toThrow()
    expect(good).toHaveBeenCalledWith(event)
  })
})
