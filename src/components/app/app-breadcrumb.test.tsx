import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { AppBreadcrumb, breadcrumbTrail } from "./app-breadcrumb"

let mockPathname = "/dashboard"

vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
}))

describe("breadcrumbTrail", () => {
  it("returns a single crumb for a top-level section", () => {
    expect(breadcrumbTrail("/dashboard")).toEqual([{ label: "Dashboard", href: "/dashboard" }])
    expect(breadcrumbTrail("/app/settings")).toEqual([
      { label: "Settings", href: "/app/settings" },
    ])
  })

  it("adds a crumb per remaining path segment with accumulated hrefs", () => {
    expect(breadcrumbTrail("/app/agent/runs/abc-123")).toEqual([
      { label: "Agent", href: "/app/agent" },
      { label: "Runs", href: "/app/agent/runs" },
      { label: "Abc 123", href: "/app/agent/runs/abc-123" },
    ])
  })

  it("humanizes hyphenated segments", () => {
    const trail = breadcrumbTrail("/app/security/login-history")
    expect(trail.at(-1)?.label).toBe("Login History")
  })

  it("falls back to a single crumb for unmatched routes", () => {
    expect(breadcrumbTrail("/")).toEqual([{ label: "Dashboard" }])
    expect(breadcrumbTrail("/nowhere")).toEqual([{ label: "Spindle" }])
  })
})

describe("AppBreadcrumb", () => {
  it("renders the trail with the current page as text, not a link", () => {
    mockPathname = "/app/agent/runs"
    render(<AppBreadcrumb />)

    const nav = screen.getByRole("navigation", { name: "breadcrumb" })
    expect(nav).toHaveTextContent("Agent")
    expect(nav).toHaveTextContent("Runs")
    expect(screen.getByRole("link", { name: "Agent" })).toHaveAttribute("href", "/app/agent")
    // The last crumb is the current page: plain text with aria-current.
    expect(screen.getByText("Runs")).toHaveAttribute("aria-current", "page")
    expect(screen.queryByRole("link", { name: "Runs" })).not.toBeInTheDocument()
  })
})
