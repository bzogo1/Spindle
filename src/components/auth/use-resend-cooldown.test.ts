import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  notifyResendCooldown,
  RESEND_COOLDOWN_STORAGE_KEY,
  useResendCooldown,
} from "./use-resend-cooldown"

const KEY_A = "spindle:auth:resend-cooldown:flow-a"
const KEY_B = "spindle:auth:resend-cooldown:flow-b"

beforeEach(() => {
  window.sessionStorage.clear()
})

afterEach(() => {
  window.sessionStorage.clear()
  vi.useRealTimers()
})

describe("useResendCooldown", () => {
  it("starts at zero and reports canResend", () => {
    const { result } = renderHook(() => useResendCooldown({ seconds: 30 }))

    expect(result.current.remaining).toBe(0)
    expect(result.current.canResend).toBe(true)
  })

  it("counts down one second at a time after start()", () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useResendCooldown({ seconds: 3 }))

    act(() => result.current.start())
    expect(result.current.remaining).toBe(3)
    expect(result.current.canResend).toBe(false)

    for (const expected of [2, 1, 0]) {
      act(() => {
        vi.advanceTimersByTime(1000)
      })
      expect(result.current.remaining).toBe(expected)
    }
    expect(result.current.canResend).toBe(true)
  })

  it("reset() clears the countdown immediately", () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useResendCooldown({ seconds: 30 }))

    act(() => result.current.start())
    expect(result.current.remaining).toBe(30)

    act(() => result.current.reset())
    expect(result.current.remaining).toBe(0)
    expect(result.current.canResend).toBe(true)
  })

  it("persists the deadline in sessionStorage and restores it on remount", () => {
    vi.useFakeTimers()
    vi.setSystemTime(100_000)

    const first = renderHook(() => useResendCooldown({ seconds: 30 }))
    act(() => first.result.current.start())
    expect(first.result.current.remaining).toBe(30)
    expect(window.sessionStorage.getItem(RESEND_COOLDOWN_STORAGE_KEY)).toBe("130000")
    first.unmount()

    // Two seconds later a fresh mount picks up the remaining 28 seconds.
    vi.setSystemTime(102_000)
    const second = renderHook(() => useResendCooldown({ seconds: 30 }))
    expect(second.result.current.remaining).toBe(28)
    expect(second.result.current.canResend).toBe(false)
  })

  it("clears the stored deadline once the countdown reaches zero", () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useResendCooldown({ seconds: 2 }))

    act(() => result.current.start())
    expect(window.sessionStorage.getItem(RESEND_COOLDOWN_STORAGE_KEY)).not.toBeNull()

    for (const expected of [1, 0]) {
      act(() => {
        vi.advanceTimersByTime(1000)
      })
      expect(result.current.remaining).toBe(expected)
    }
    expect(window.sessionStorage.getItem(RESEND_COOLDOWN_STORAGE_KEY)).toBeNull()
  })

  it("adopts server retryAfter values pushed via notifyResendCooldown", () => {
    const { result } = renderHook(() => useResendCooldown({ seconds: 30 }))

    act(() => notifyResendCooldown(55))
    expect(result.current.remaining).toBe(55)
    expect(result.current.canResend).toBe(false)
    expect(window.sessionStorage.getItem(RESEND_COOLDOWN_STORAGE_KEY)).not.toBeNull()
  })

  it("never lets a shorter local start() undercut a server deadline", () => {
    const { result } = renderHook(() => useResendCooldown({ seconds: 30 }))

    // Server says 60s; the form's own 30s start must not shorten it.
    act(() => notifyResendCooldown(60))
    act(() => result.current.start())
    expect(result.current.remaining).toBe(60)
  })

  it("sync() applies an explicit retry delay", () => {
    const { result } = renderHook(() => useResendCooldown({ seconds: 30 }))

    act(() => result.current.sync(12))
    expect(result.current.remaining).toBe(12)
  })
})

describe("useResendCooldown storageKey scoping", () => {
  it("keeps deadlines isolated per flow key", () => {
    const flowA = renderHook(() => useResendCooldown({ seconds: 30, storageKey: KEY_A }))
    const flowB = renderHook(() => useResendCooldown({ seconds: 30, storageKey: KEY_B }))

    act(() => flowA.result.current.start())
    expect(flowA.result.current.remaining).toBe(30)
    expect(flowB.result.current.remaining).toBe(0)
    expect(window.sessionStorage.getItem(KEY_A)).not.toBeNull()
    expect(window.sessionStorage.getItem(KEY_B)).toBeNull()
  })

  it("notifyResendCooldown only reaches hooks with the matching key", () => {
    const flowA = renderHook(() => useResendCooldown({ seconds: 30, storageKey: KEY_A }))
    const flowB = renderHook(() => useResendCooldown({ seconds: 30, storageKey: KEY_B }))
    const fallback = renderHook(() => useResendCooldown({ seconds: 30 }))

    act(() => notifyResendCooldown(45, KEY_A))

    expect(flowA.result.current.remaining).toBe(45)
    expect(flowB.result.current.remaining).toBe(0)
    expect(fallback.result.current.remaining).toBe(0)
    expect(window.sessionStorage.getItem(KEY_A)).not.toBeNull()
    expect(window.sessionStorage.getItem(KEY_B)).toBeNull()
    expect(window.sessionStorage.getItem(RESEND_COOLDOWN_STORAGE_KEY)).toBeNull()
  })

  it("persists per-key deadlines independently across remounts", () => {
    vi.useFakeTimers()
    vi.setSystemTime(50_000)

    const first = renderHook(() => useResendCooldown({ seconds: 30, storageKey: KEY_A }))
    act(() => first.result.current.start())
    first.unmount()

    vi.setSystemTime(52_000)
    const second = renderHook(() => useResendCooldown({ seconds: 30, storageKey: KEY_A }))
    const other = renderHook(() => useResendCooldown({ seconds: 30, storageKey: KEY_B }))

    expect(second.result.current.remaining).toBe(28)
    expect(other.result.current.remaining).toBe(0)
  })
})
