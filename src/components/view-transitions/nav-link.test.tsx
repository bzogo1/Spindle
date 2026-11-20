import { render, screen } from "@testing-library/react"
import type { AnchorHTMLAttributes, ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { NAV_BACK, NAV_FORWARD } from "./vt-support"
import { NavLink } from "./nav-link"

interface CapturedLinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  transitionTypes?: string[]
  children?: ReactNode
}

const linkCalls = vi.hoisted(() => ({
  calls: [] as CapturedLinkProps[],
}))

// next/link is a client component that needs the app router; stub it with an
// anchor that records the props NavLink forwards.
vi.mock("next/link", () => ({
  default: (props: CapturedLinkProps) => {
    linkCalls.calls.push(props)
    const { transitionTypes: _transitionTypes, children, ...rest } = props
    return <a {...rest}>{children}</a>
  },
}))

beforeEach(() => {
  linkCalls.calls.length = 0
})

describe("NavLink", () => {
  it("defaults to the nav-forward transition type", () => {
    render(<NavLink href="/projects/p1">Open project</NavLink>)

    expect(linkCalls.calls).toHaveLength(1)
    expect(linkCalls.calls[0].transitionTypes).toEqual([NAV_FORWARD])
    expect(screen.getByRole("link", { name: "Open project" })).toHaveAttribute(
      "href",
      "/projects/p1",
    )
  })

  it("passes nav-back when direction is nav-back", () => {
    render(
      <NavLink href="/projects" direction={NAV_BACK}>
        Back to projects
      </NavLink>,
    )

    expect(linkCalls.calls[0].transitionTypes).toEqual([NAV_BACK])
  })

  it("forwards remaining Link props unchanged", () => {
    render(
      <NavLink href="/chat" className="nav-item" aria-label="Chat">
        Chat
      </NavLink>,
    )

    const props = linkCalls.calls[0]
    expect(props.href).toBe("/chat")
    expect(props.className).toBe("nav-item")
    expect(props["aria-label"]).toBe("Chat")
    expect(screen.getByRole("link", { name: "Chat" })).toBeInTheDocument()
  })
})
