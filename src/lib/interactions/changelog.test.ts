import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { initChangelog } from "./changelog.js"

describe("initChangelog", () => {
  beforeAll(() => {
    initChangelog()
  })

  beforeEach(() => {
    localStorage.clear()
    document.documentElement.classList.remove("dark")
    document.body.innerHTML = ""
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn(async () => {}) },
      configurable: true,
    })
  })

  it("toggles the dark class on .cl-theme-toggle clicks", () => {
    const toggle = document.createElement("button")
    toggle.className = "cl-theme-toggle"
    document.body.appendChild(toggle)

    toggle.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    expect(document.documentElement.classList.contains("dark")).toBe(true)
    expect(localStorage.getItem("spindle-site-theme")).toBe("dark")
    expect(localStorage.getItem("changelog-theme")).toBeNull()

    toggle.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    expect(document.documentElement.classList.contains("dark")).toBe(false)
    expect(localStorage.getItem("spindle-site-theme")).toBe("light")
  })

  it("copies the permalink and shows 'Copied' for .cl-copy-link buttons added after init", async () => {
    // Simulates a permalink page rendered by a later SPA navigation.
    const button = document.createElement("button")
    button.className = "cl-copy-link"
    button.setAttribute("data-url", "/changelog/v1")
    button.textContent = "Copy link"
    document.body.appendChild(button)

    button.dispatchEvent(new MouseEvent("click", { bubbles: true }))

    await vi.waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        new URL("/changelog/v1", window.location.origin).href,
      )
    })
    await vi.waitFor(() => {
      expect(button.textContent).toBe("Copied")
    })
  })

  it("does not double-bind when init is called again", async () => {
    initChangelog()

    const button = document.createElement("button")
    button.className = "cl-copy-link"
    button.setAttribute("data-url", "/changelog/v2")
    document.body.appendChild(button)

    button.dispatchEvent(new MouseEvent("click", { bubbles: true }))

    await vi.waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1)
    })
  })
})
