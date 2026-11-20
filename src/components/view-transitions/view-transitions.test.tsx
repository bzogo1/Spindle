import { render, screen } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { NAV_BACK, NAV_FORWARD } from "./vt-support"
import { PageTransition, SharedElement } from "./view-transitions"

interface CapturedViewTransition {
  name?: string
  share?: string
  default?: string
  enter?: Record<string, string>
  exit?: Record<string, string>
  children?: ReactNode
}

const viewTransitionCalls = vi.hoisted(() => ({
  calls: [] as CapturedViewTransition[],
}))

// Replace React's host <ViewTransition> with a probe that records the props
// PageTransition/SharedElement pass down. The real component renders its
// children unwrapped outside an active transition, so props are the only
// observable difference in jsdom.
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>()
  return {
    ...actual,
    ViewTransition: (props: CapturedViewTransition) => {
      viewTransitionCalls.calls.push(props)
      return actual.createElement(actual.Fragment, null, props.children)
    },
  }
})

function stubViewTransitionSupport() {
  Object.defineProperty(document, "startViewTransition", {
    value: vi.fn(),
    configurable: true,
    writable: true,
  })
}

beforeEach(() => {
  viewTransitionCalls.calls.length = 0
})

afterEach(() => {
  // The stub is a plain property, not a spy, so restoreMocks won't undo it.
  delete (document as { startViewTransition?: unknown }).startViewTransition
})

describe("PageTransition", () => {
  it("renders children unwrapped when view transitions are unsupported", () => {
    render(
      <PageTransition>
        <div>page body</div>
      </PageTransition>,
    )

    expect(screen.getByText("page body")).toBeInTheDocument()
    expect(viewTransitionCalls.calls).toHaveLength(0)
  })

  it("maps nav-forward/nav-back transition types to directional classes", () => {
    stubViewTransitionSupport()

    render(
      <PageTransition>
        <div>page body</div>
      </PageTransition>,
    )

    expect(viewTransitionCalls.calls).toHaveLength(1)
    const props = viewTransitionCalls.calls[0]
    expect(props.enter).toEqual({
      [NAV_FORWARD]: "nav-forward",
      [NAV_BACK]: "nav-back",
      default: "none",
    })
    expect(props.exit).toEqual(props.enter)
    expect(props.default).toBe("none")
  })

  it("renders children inside ViewTransition when supported", () => {
    stubViewTransitionSupport()

    render(
      <PageTransition>
        <div>page body</div>
      </PageTransition>,
    )

    expect(screen.getByText("page body")).toBeInTheDocument()
  })
})

describe("SharedElement", () => {
  it("renders children unwrapped when view transitions are unsupported", () => {
    render(
      <SharedElement name="spindle-project-p1">
        <span>card</span>
      </SharedElement>,
    )

    expect(screen.getByText("card")).toBeInTheDocument()
    expect(viewTransitionCalls.calls).toHaveLength(0)
  })

  it("passes name, morph sharing and default none when supported", () => {
    stubViewTransitionSupport()

    render(
      <SharedElement name="spindle-project-p1">
        <span>card</span>
      </SharedElement>,
    )

    expect(viewTransitionCalls.calls).toHaveLength(1)
    const props = viewTransitionCalls.calls[0]
    expect(props.name).toBe("spindle-project-p1")
    expect(props.share).toBe("morph")
    expect(props.default).toBe("none")
  })
})
