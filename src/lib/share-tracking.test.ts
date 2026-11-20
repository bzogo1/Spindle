import { beforeEach, describe, expect, it } from "vitest"

import {
  recordShareClick,
  resetShareTrackingForTests,
  shareClickCount,
  shareClickCounts,
} from "./share-tracking"

beforeEach(() => {
  resetShareTrackingForTests()
})

describe("share-tracking store", () => {
  it("counts clicks per platform and per platform+code", () => {
    recordShareClick("x")
    recordShareClick("x")
    recordShareClick("x", "SPN-ABCD-EFGH")
    recordShareClick("whatsapp")

    expect(shareClickCount("x")).toBe(2)
    expect(shareClickCount("x", "SPN-ABCD-EFGH")).toBe(1)
    expect(shareClickCount("whatsapp")).toBe(1)
    expect(shareClickCount("telegram")).toBe(0)
    expect(shareClickCounts()).toEqual({
      x: 2,
      "x:SPN-ABCD-EFGH": 1,
      whatsapp: 1,
    })
  })

  it("bounds distinct keys and evicts the oldest", () => {
    for (let i = 0; i < 300; i++) {
      recordShareClick(`platform-${i}`)
    }
    const counts = shareClickCounts()
    expect(Object.keys(counts).length).toBeLessThanOrEqual(256)
    // The earliest keys were evicted; the latest survive.
    expect(counts["platform-0"]).toBeUndefined()
    expect(counts["platform-299"]).toBe(1)
  })
})
