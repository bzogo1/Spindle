import "@testing-library/jest-dom/vitest"

import { cleanup } from "@testing-library/react"
import { afterEach, vi } from "vitest"

afterEach(() => {
  // Node-environment suites (logger, request tracing) have no DOM to clean up.
  if (typeof document !== "undefined") cleanup()
})

// Radix UI and the app's interaction scripts rely on browser APIs that jsdom
// does not implement.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

class IntersectionObserverStub {
  root = null
  rootMargin = ""
  thresholds: number[] = []
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return []
  }
}

if (!("ResizeObserver" in globalThis)) {
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver
}

if (!("IntersectionObserver" in globalThis)) {
  globalThis.IntersectionObserver =
    IntersectionObserverStub as unknown as typeof IntersectionObserver
}

if (typeof window !== "undefined") {
  if (!window.matchMedia) {
    window.matchMedia = (query: string) =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }) as MediaQueryList
  }

  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {}
  }

  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false
  }

  if (!Element.prototype.setPointerCapture) {
    Element.prototype.setPointerCapture = () => {}
  }

  if (!Element.prototype.releasePointerCapture) {
    Element.prototype.releasePointerCapture = () => {}
  }
}

// Unit tests never touch the network; API-driven components should mock fetch
// explicitly instead of falling through to a real request.
globalThis.fetch = vi.fn(async () => {
  throw new Error("Unexpected network request in a unit test")
}) as unknown as typeof fetch
