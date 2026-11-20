import { act, render, renderHook } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { AgentRunBadge, useNow } from "./agent-run-log-shared"

afterEach(() => {
  vi.useRealTimers()
})

describe("AgentRunBadge", () => {
  it("renders the status label with a status class", () => {
    const { container } = render(<AgentRunBadge status="waiting_approval" />)
    const badge = container.querySelector(".app-badge")
    expect(badge).not.toBeNull()
    expect(badge?.textContent).toBe("waiting approval")
    expect(badge?.className).toContain("is-waiting_approval")
  })
})

describe("useNow", () => {
  it("returns the current time and ticks on the interval", () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useNow(1000))
    const initial = result.current

    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(result.current).toBeGreaterThanOrEqual(initial)

    act(() => {
      vi.advanceTimersByTime(2000)
    })
    expect(result.current).toBeGreaterThanOrEqual(initial)
  })

  it("clears its interval on unmount", () => {
    vi.useFakeTimers()
    const { unmount } = renderHook(() => useNow(500))
    expect(vi.getTimerCount()).toBe(1)
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})
