import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { themeScript } from "./layout"

const originalMatchMedia = window.matchMedia

function stubOsDark(dark: boolean) {
  window.matchMedia = vi.fn((query: string) => ({
    matches: query === "(prefers-color-scheme: dark)" ? dark : false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
}

const runScript = () => new Function(themeScript)()
const isDark = () => document.documentElement.classList.contains("dark")

describe("changelog themeScript", () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.classList.remove("dark")
  })

  afterEach(() => {
    window.matchMedia = originalMatchMedia
  })

  it("defaults to dark with no stored preference, regardless of the OS", () => {
    stubOsDark(false)
    runScript()
    expect(isDark()).toBe(true)

    document.documentElement.classList.remove("dark")
    stubOsDark(true)
    runScript()
    expect(isDark()).toBe(true)
  })

  it("treats invalid shared-key values as no preference (dark)", () => {
    stubOsDark(false)
    localStorage.setItem("spindle-site-theme", "neon")
    runScript()
    expect(isDark()).toBe(true)
  })

  it("follows the OS only for an explicit system preference", () => {
    localStorage.setItem("spindle-site-theme", "system")

    stubOsDark(false)
    runScript()
    expect(isDark()).toBe(false)

    stubOsDark(true)
    runScript()
    expect(isDark()).toBe(true)
  })

  it("honors explicit light and dark over the OS", () => {
    stubOsDark(true)
    localStorage.setItem("spindle-site-theme", "light")
    runScript()
    expect(isDark()).toBe(false)

    stubOsDark(false)
    localStorage.setItem("spindle-site-theme", "dark")
    runScript()
    expect(isDark()).toBe(true)
  })

  it("reads the legacy changelog-theme key and migrates it", () => {
    localStorage.setItem("changelog-theme", "light")
    runScript()
    expect(isDark()).toBe(false)
    expect(localStorage.getItem("spindle-site-theme")).toBe("light")
    expect(localStorage.getItem("changelog-theme")).toBeNull()
  })

  it("ignores the legacy key when the shared key is set", () => {
    localStorage.setItem("spindle-site-theme", "dark")
    localStorage.setItem("changelog-theme", "light")
    runScript()
    expect(isDark()).toBe(true)
    // Shared key wins; legacy value is left untouched for the toggle to clear.
    expect(localStorage.getItem("changelog-theme")).toBe("light")
  })
})
