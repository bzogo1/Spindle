import { describe, expect, it } from "vitest"

import {
  getCurrentPushSubscription,
  isPushSupported,
  subscribeToPush,
  unsubscribeFromPush,
} from "@/lib/pwa/push"

describe("push helpers in unsupported environments", () => {
  it("reports push as unsupported under jsdom", () => {
    expect(isPushSupported()).toBe(false)
  })

  it("subscribeToPush resolves instead of throwing", async () => {
    await expect(subscribeToPush("dGVzdA")).resolves.toEqual({ status: "unsupported" })
  })

  it("subscription lookups and unsubscribe degrade to null/false", async () => {
    await expect(getCurrentPushSubscription()).resolves.toBeNull()
    await expect(unsubscribeFromPush()).resolves.toBe(false)
  })
})
