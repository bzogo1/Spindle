import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { APP_SHELL_COMPACT_KEY, APP_SHELL_SIDEBAR_KEY, usePersistedFlag } from "./app-shell-prefs"

beforeEach(() => {
  window.localStorage.removeItem(APP_SHELL_SIDEBAR_KEY)
  window.localStorage.removeItem(APP_SHELL_COMPACT_KEY)
})

afterEach(() => {
  window.localStorage.removeItem(APP_SHELL_SIDEBAR_KEY)
  window.localStorage.removeItem(APP_SHELL_COMPACT_KEY)
})

describe("usePersistedFlag", () => {
  it("starts at the default and applies the stored flag on mount", () => {
    window.localStorage.setItem(APP_SHELL_SIDEBAR_KEY, "1")

    const { result } = renderHook(() => usePersistedFlag(APP_SHELL_SIDEBAR_KEY))

    expect(result.current[0]).toBe(true)
  })

  it("persists flag changes to localStorage", () => {
    const { result } = renderHook(() => usePersistedFlag(APP_SHELL_COMPACT_KEY))
    expect(result.current[0]).toBe(false)

    act(() => {
      result.current[1]((current) => !current)
    })

    expect(result.current[0]).toBe(true)
    expect(window.localStorage.getItem(APP_SHELL_COMPACT_KEY)).toBe("1")
  })

  it("does not clobber the stored value before the mount restore applies", () => {
    window.localStorage.setItem(APP_SHELL_SIDEBAR_KEY, "1")

    renderHook(() => usePersistedFlag(APP_SHELL_SIDEBAR_KEY))

    expect(window.localStorage.getItem(APP_SHELL_SIDEBAR_KEY)).toBe("1")
  })

  it("syncs when another tab writes to storage", () => {
    const { result } = renderHook(() => usePersistedFlag(APP_SHELL_SIDEBAR_KEY))

    act(() => {
      window.localStorage.setItem(APP_SHELL_SIDEBAR_KEY, "1")
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: APP_SHELL_SIDEBAR_KEY,
          newValue: "1",
        }),
      )
    })

    expect(result.current[0]).toBe(true)
  })

  it("resets to the default when another tab clears storage", () => {
    const { result } = renderHook(() => usePersistedFlag(APP_SHELL_SIDEBAR_KEY))

    act(() => {
      result.current[1](true)
    })
    expect(result.current[0]).toBe(true)

    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: null }))
    })

    expect(result.current[0]).toBe(false)
  })

  it("ignores storage events for unrelated keys", () => {
    const { result } = renderHook(() => usePersistedFlag(APP_SHELL_SIDEBAR_KEY))

    act(() => {
      window.localStorage.setItem(APP_SHELL_SIDEBAR_KEY, "1")
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: "spindle-unrelated",
          newValue: "1",
        }),
      )
    })

    expect(result.current[0]).toBe(false)
  })
});
