import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  applySiteTheme,
  readSiteThemeMode,
  SITE_THEME_EVENT,
  SITE_THEME_KEY,
  SITE_THEME_SCRIPT,
  siteThemeDark,
} from "./site-theme"

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

beforeEach(() => {
  localStorage.clear()
  document.documentElement.classList.remove("dark")
})

afterEach(() => {
  window.matchMedia = originalMatchMedia
})

describe("readSiteThemeMode", () => {
  it("defaults to dark when nothing is stored", () => {
    expect(readSiteThemeMode()).toBe("dark")
  })

  it("returns stored valid modes", () => {
    for (const mode of ["light", "dark", "system"] as const) {
      localStorage.setItem(SITE_THEME_KEY, mode)
      expect(readSiteThemeMode()).toBe(mode)
    }
  })

  it("falls back to dark for unrecognized values", () => {
    localStorage.setItem(SITE_THEME_KEY, "neon")
    expect(readSiteThemeMode()).toBe("dark")
  })
})

describe("siteThemeDark", () => {
  it("resolves explicit modes without consulting matchMedia", () => {
    expect(siteThemeDark("light")).toBe(false)
    expect(siteThemeDark("dark")).toBe(true)
  })

  it("defers to prefers-color-scheme for system", () => {
    // vitest.setup stubs matchMedia with matches: false.
    expect(siteThemeDark("system")).toBe(false)
  })
})

describe("applySiteTheme", () => {
  it("toggles the dark class, persists, and emits an event", () => {
    let fired = 0
    const listener = () => fired++
    window.addEventListener(SITE_THEME_EVENT, listener)

    applySiteTheme("dark")
    expect(document.documentElement.classList.contains("dark")).toBe(true)
    expect(localStorage.getItem(SITE_THEME_KEY)).toBe("dark")

    applySiteTheme("light")
    expect(document.documentElement.classList.contains("dark")).toBe(false)
    expect(localStorage.getItem(SITE_THEME_KEY)).toBe("light")
    expect(fired).toBe(2)

    window.removeEventListener(SITE_THEME_EVENT, listener)
  })
})

describe("SITE_THEME_SCRIPT", () => {
  const runScript = () => new Function(SITE_THEME_SCRIPT)()
  const isDark = () => document.documentElement.classList.contains("dark")

  it("keeps dark with no stored preference, regardless of the OS", () => {
    stubOsDark(false)
    runScript()
    expect(isDark()).toBe(true)

    document.documentElement.classList.remove("dark")
    stubOsDark(true)
    runScript()
    expect(isDark()).toBe(true)
  })

  it("follows the OS only for an explicit system preference", () => {
    localStorage.setItem(SITE_THEME_KEY, "system")

    stubOsDark(false)
    runScript()
    expect(isDark()).toBe(false)

    stubOsDark(true)
    runScript()
    expect(isDark()).toBe(true)
  })

  it("honors explicit light and dark over the OS", () => {
    stubOsDark(true)
    localStorage.setItem(SITE_THEME_KEY, "light")
    runScript()
    expect(isDark()).toBe(false)

    stubOsDark(false)
    localStorage.setItem(SITE_THEME_KEY, "dark")
    runScript()
    expect(isDark()).toBe(true)
  })

  it("treats unrecognized stored values as no preference (dark)", () => {
    stubOsDark(false)
    localStorage.setItem(SITE_THEME_KEY, "neon")
    runScript()
    expect(isDark()).toBe(true)
  })
})
