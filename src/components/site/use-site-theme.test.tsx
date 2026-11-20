import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { applySiteTheme, readSiteThemeMode, SITE_THEME_KEY, siteThemeDark } from "./site-theme"
import { useSiteTheme } from "./use-site-theme"

function clearTheme() {
  document.documentElement.classList.remove("dark")
  window.localStorage.removeItem(SITE_THEME_KEY)
}

beforeEach(clearTheme)
afterEach(clearTheme)

describe("site theme helpers", () => {
  it("defaults to dark and resolves system via prefers-color-scheme", () => {
    expect(readSiteThemeMode()).toBe("dark")
    expect(siteThemeDark("system")).toBe(false)
    expect(siteThemeDark("dark")).toBe(true)
    expect(siteThemeDark("light")).toBe(false)
  })

  it("applySiteTheme toggles the class and persists the mode", () => {
    applySiteTheme("dark")
    expect(document.documentElement.classList.contains("dark")).toBe(true)
    expect(window.localStorage.getItem(SITE_THEME_KEY)).toBe("dark")
    expect(readSiteThemeMode()).toBe("dark")

    applySiteTheme("light")
    expect(document.documentElement.classList.contains("dark")).toBe(false)
    expect(window.localStorage.getItem(SITE_THEME_KEY)).toBe("light")
  })
})

describe("useSiteTheme", () => {
  it("reads the stored mode on mount", () => {
    window.localStorage.setItem(SITE_THEME_KEY, "dark")
    document.documentElement.classList.add("dark")

    const { result } = renderHook(() => useSiteTheme())

    expect(result.current.mode).toBe("dark")
    expect(result.current.dark).toBe(true)
  })

  it("cycles dark → system → light from the no-preference default", () => {
    const { result } = renderHook(() => useSiteTheme())
    expect(result.current.mode).toBe("dark")
    expect(result.current.dark).toBe(true)

    act(() => result.current.cycle())
    expect(result.current.mode).toBe("system")
    expect(window.localStorage.getItem(SITE_THEME_KEY)).toBe("system")

    act(() => result.current.cycle())
    expect(result.current.mode).toBe("light")
    expect(document.documentElement.classList.contains("dark")).toBe(false)
    expect(window.localStorage.getItem(SITE_THEME_KEY)).toBe("light")

    act(() => result.current.cycle())
    expect(result.current.mode).toBe("dark")
    expect(document.documentElement.classList.contains("dark")).toBe(true)
    expect(window.localStorage.getItem(SITE_THEME_KEY)).toBe("dark")
  })

  it("follows OS changes only while in explicit system mode", () => {
    window.localStorage.setItem(SITE_THEME_KEY, "system")
    const originalMatchMedia = window.matchMedia
    let osDark = false
    const listeners = new Set<() => void>()
    window.matchMedia = vi.fn((query: string) => ({
      matches: query === "(prefers-color-scheme: dark)" ? osDark : false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: (_: string, cb: () => void) => listeners.add(cb),
      removeEventListener: (_: string, cb: () => void) => listeners.delete(cb),
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia

    const { result } = renderHook(() => useSiteTheme())
    expect(result.current.mode).toBe("system")
    expect(result.current.dark).toBe(false)

    act(() => {
      osDark = true
      listeners.forEach((cb) => cb())
    })

    expect(document.documentElement.classList.contains("dark")).toBe(true)
    expect(result.current.dark).toBe(true)

    // An explicit mode ignores later OS changes.
    act(() => result.current.set("light"))
    act(() => {
      osDark = false
      listeners.forEach((cb) => cb())
    })
    expect(document.documentElement.classList.contains("dark")).toBe(false)
    expect(result.current.dark).toBe(false)

    window.matchMedia = originalMatchMedia
  })

  it("ignores OS changes with no stored preference (stays dark)", () => {
    const originalMatchMedia = window.matchMedia
    let osDark = false
    const listeners = new Set<() => void>()
    window.matchMedia = vi.fn((query: string) => ({
      matches: query === "(prefers-color-scheme: dark)" ? osDark : false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: (_: string, cb: () => void) => listeners.add(cb),
      removeEventListener: (_: string, cb: () => void) => listeners.delete(cb),
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia

    const { result } = renderHook(() => useSiteTheme())
    expect(result.current.mode).toBe("dark")
    expect(result.current.dark).toBe(true)

    act(() => {
      osDark = false
      listeners.forEach((cb) => cb())
    })
    expect(result.current.dark).toBe(true)
    expect(document.documentElement.classList.contains("dark")).toBe(false)

    window.matchMedia = originalMatchMedia
  })
})
