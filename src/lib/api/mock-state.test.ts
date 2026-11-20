import { describe, expect, it, vi } from "vitest"

import {
  MOCK_STATE_EVENT,
  getMockLatencyMs,
  getMockState,
  notifyMockStateChange,
  setMockStateParam,
} from "./mock-state"

describe("getMockState", () => {
  it("reads the mock param", () => {
    expect(getMockState("mock=loading")).toBe("loading")
    expect(getMockState("mock=empty")).toBe("empty")
    expect(getMockState("mock=error")).toBe("error")
    expect(getMockState("mock=ready")).toBe("ready")
  })

  it("accepts mockState and demo aliases", () => {
    expect(getMockState("mockState=loading")).toBe("loading")
    expect(getMockState("demo=loading")).toBe("loading")
    expect(getMockState("demo=empty")).toBe("empty")
  })

  it("defaults to ready for missing or unknown values", () => {
    expect(getMockState("")).toBe("ready")
    expect(getMockState("demo=bogus")).toBe("ready")
  })
})

describe("getMockLatencyMs", () => {
  it("reads latency params and clamps to the max", () => {
    expect(getMockLatencyMs("mockLatency=250")).toBe(250)
    expect(getMockLatencyMs("mockDelay=100")).toBe(100)
    expect(getMockLatencyMs("demoLatency=500")).toBe(500)
    expect(getMockLatencyMs("demoDelay=750")).toBe(750)
    expect(getMockLatencyMs("mockLatency=999999")).toBe(10_000)
  })

  it("defaults to zero for missing or invalid values", () => {
    expect(getMockLatencyMs("")).toBe(0)
    expect(getMockLatencyMs("mockLatency=abc")).toBe(0)
    expect(getMockLatencyMs("mockLatency=-5")).toBe(0)
  })
})

describe("setMockStateParam", () => {
  function currentParams() {
    return new URLSearchParams(window.location.search)
  }

  it("writes the mock param and preserves unrelated params", () => {
    window.history.replaceState(null, "", "/?foo=1")
    const listener = vi.fn()
    window.addEventListener(MOCK_STATE_EVENT, listener)

    setMockStateParam("loading")

    expect(currentParams().get("mock")).toBe("loading")
    expect(currentParams().get("foo")).toBe("1")
    expect(listener).toHaveBeenCalledTimes(1)

    window.removeEventListener(MOCK_STATE_EVENT, listener)
  })

  it("clears the mock params when the state returns to ready", () => {
    window.history.replaceState(null, "", "/?mock=loading&mockState=empty&foo=1")

    setMockStateParam("ready")

    expect(currentParams().get("mock")).toBeNull()
    expect(currentParams().get("mockState")).toBeNull()
    expect(currentParams().get("foo")).toBe("1")
  })
})

describe("notifyMockStateChange", () => {
  it("dispatches the mock state event on window", () => {
    const listener = vi.fn()
    window.addEventListener(MOCK_STATE_EVENT, listener)

    notifyMockStateChange()

    expect(listener).toHaveBeenCalledTimes(1)
    window.removeEventListener(MOCK_STATE_EVENT, listener)
  })
})
