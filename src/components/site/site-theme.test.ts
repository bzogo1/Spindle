import { afterEach, describe, expect, it, vi } from "vitest"

import { SITE_THEME_SCRIPT } from "./site-theme"

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

const runScript = () => new Function(SITE_THEME_SCRIPT)()
const isDark = () => document.documentElement.classList.contains("dark")

afterEach(() => {
  window.matchMedia = originalMatchMedia
  document.documentElement.classList.remove("dark")
})

describe("SITE_THEME_SCRIPT", () => {
  it("applies dark when the OS prefers a dark color scheme", () => {
    stubOsDark(true)
    runScript()
    expect(isDark()).toBe(true)
  })

  it("applies light when the OS prefers a light color scheme", () => {
    stubOsDark(false)
    runScript()
    expect(isDark()).toBe(false)
  })

  it("stays light when matchMedia is unavailable", () => {
    window.matchMedia = undefined as unknown as typeof window.matchMedia
    runScript()
    expect(isDark()).toBe(false)
  })
})
