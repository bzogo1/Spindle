import { render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import { useViewTransitionSupported } from "./use-view-transition-supported"

function Probe() {
  const supported = useViewTransitionSupported()
  return <div data-testid="probe">{supported ? "supported" : "unsupported"}</div>
}

function stubStartViewTransition() {
  Object.defineProperty(document, "startViewTransition", {
    value: () => ({}),
    configurable: true,
    writable: true,
  })
}

afterEach(() => {
  // The stub is a plain property, not a spy, so restoreMocks won't undo it.
  delete (document as { startViewTransition?: unknown }).startViewTransition
})

describe("useViewTransitionSupported", () => {
  it("returns false when the browser lacks view transition APIs", () => {
    render(<Probe />)

    expect(screen.getByTestId("probe")).toHaveTextContent("unsupported")
  })

  it("returns true when startViewTransition and view-transition-name are available", () => {
    stubStartViewTransition()

    render(<Probe />)

    expect(screen.getByTestId("probe")).toHaveTextContent("supported")
  })
})
