import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  publishNotificationEvent,
  resetNotificationHubForTests,
  subscribeNotificationEvents,
} from "./hub"
import type { NotificationStreamEvent } from "./events"

const event: NotificationStreamEvent = {
  type: "notification",
  notification: { type: "info", title: "Ping", body: "Pong" },
}

beforeEach(() => {
  resetNotificationHubForTests()
})

describe("notification hub", () => {
  it("delivers published events to subscribers of the same principal", () => {
    const listener = vi.fn()
    subscribeNotificationEvents("user:1", listener)

    publishNotificationEvent("user:1", event)
    expect(listener).toHaveBeenCalledWith(event)
  })

  it("does not deliver across principals", () => {
    const listener = vi.fn()
    subscribeNotificationEvents("user:1", listener)

    publishNotificationEvent("user:2", event)
    expect(listener).not.toHaveBeenCalled()
  })

  it("stops delivering after unsubscribe and tolerates double unsubscribe", () => {
    const listener = vi.fn()
    const unsubscribe = subscribeNotificationEvents("user:1", listener)

    unsubscribe()
    unsubscribe()
    publishNotificationEvent("user:1", event)
    expect(listener).not.toHaveBeenCalled()
  })

  it("isolates throwing listeners from the rest of the fan-out", () => {
    const bad = vi.fn(() => {
      throw new Error("boom")
    })
    const good = vi.fn()
    subscribeNotificationEvents("user:1", bad)
    subscribeNotificationEvents("user:1", good)

    expect(() => publishNotificationEvent("user:1", event)).not.toThrow()
    expect(good).toHaveBeenCalledWith(event)
  })
})
