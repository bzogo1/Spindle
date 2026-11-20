import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { APP_THEME_KEY, isAppDarkTheme, setAppDarkTheme } from "./app-theme"
import { useAppTheme } from "./use-app-theme"

function clearTheme() {
  document.documentElement.classList.remove("dark")
  window.localStorage.removeItem(APP_THEME_KEY)
}

beforeEach(clearTheme)
afterEach(clearTheme)

describe("app theme helpers", () => {
  it("reports light until the dark class is applied", () => {
    expect(isAppDarkTheme()).toBe(false)

    setAppDarkTheme(true)
    expect(isAppDarkTheme()).toBe(true)
    expect(document.documentElement.classList.contains("dark")).toBe(true)
    expect(window.localStorage.getItem(APP_THEME_KEY)).toBe("dark")

    setAppDarkTheme(false)
    expect(isAppDarkTheme()).toBe(false)
    expect(window.localStorage.getItem(APP_THEME_KEY)).toBe("light")
  })
})

describe("useAppTheme", () => {
  it("reads the current theme from the document on mount", () => {
    document.documentElement.classList.add("dark")

    const { result } = renderHook(() => useAppTheme())

    expect(result.current.dark).toBe(true)
  })

  it("toggles the theme, persists the choice, and syncs other instances", () => {
    const first = renderHook(() => useAppTheme())
    const second = renderHook(() => useAppTheme())

    expect(first.result.current.dark).toBe(false)
    expect(second.result.current.dark).toBe(false)

    act(() => {
      first.result.current.toggle()
    })

    expect(isAppDarkTheme()).toBe(true)
    expect(window.localStorage.getItem(APP_THEME_KEY)).toBe("dark")
    expect(first.result.current.dark).toBe(true)
    expect(second.result.current.dark).toBe(true)
  })

  it("set() applies an explicit theme and is a no-op when unchanged", () => {
    const { result } = renderHook(() => useAppTheme())

    act(() => {
      result.current.set(true)
    })
    expect(isAppDarkTheme()).toBe(true)
    expect(window.localStorage.getItem(APP_THEME_KEY)).toBe("dark")

    window.localStorage.setItem(APP_THEME_KEY, "tampered")
    act(() => {
      result.current.set(true)
    })
    // No change means no rewrite and no event: the stored value is untouched.
    expect(window.localStorage.getItem(APP_THEME_KEY)).toBe("tampered")
  })

  it("syncs when another control changes the class and storage", () => {
    const { result } = renderHook(() => useAppTheme())
    expect(result.current.dark).toBe(false)

    act(() => {
      setAppDarkTheme(true)
      window.dispatchEvent(new Event("storage"))
    })

    expect(result.current.dark).toBe(true)
  })

  it("applies a cross-tab storage event to the document and state", () => {
    const { result } = renderHook(() => useAppTheme())
    expect(result.current.dark).toBe(false)

    // A real StorageEvent carries the new value but does not touch this
    // document's `.dark` class — the hook must apply it itself.
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: APP_THEME_KEY, newValue: "dark" }))
    })

    expect(document.documentElement.classList.contains("dark")).toBe(true)
    expect(result.current.dark).toBe(true)

    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: APP_THEME_KEY, newValue: "light" }))
    })

    expect(document.documentElement.classList.contains("dark")).toBe(false)
    expect(result.current.dark).toBe(false)
  })

  it("ignores storage events for unrelated keys", () => {
    const { result } = renderHook(() => useAppTheme())
    document.documentElement.classList.add("dark")
    act(() => {
      result.current.set(false)
    })
    expect(result.current.dark).toBe(false)

    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", { key: "spindle-dashboard-widgets:v1", newValue: "{}" }),
      )
    })

    // Unrelated writes must not flip the theme back.
    expect(result.current.dark).toBe(false)
    expect(document.documentElement.classList.contains("dark")).toBe(false)
  })
})
