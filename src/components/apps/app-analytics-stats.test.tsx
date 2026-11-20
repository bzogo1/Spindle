import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it } from "vitest"

import { AppAnalyticsStats } from "./app-analytics-stats"
import { initAppAnalytics } from "@/lib/apps/analytics"

function grid() {
  return document.querySelector(".app-analytics-grid") as HTMLElement
}

describe("AppAnalyticsStats", () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it("shows empty state with no events", () => {
    render(<AppAnalyticsStats appId="fresh" />)
    expect(screen.getByText("No events recorded yet for this app.")).toBeInTheDocument()
    expect(within(grid()).getByText("Total events")).toBeInTheDocument()
    // Total events and event types both read "0" when empty.
    expect(within(grid()).getAllByText("0").length).toBeGreaterThan(0)
  })

  it("renders aggregated stats for recorded events", () => {
    const client = initAppAnalytics("demo")
    client.track("open")
    client.track("click")
    client.track("open")

    render(<AppAnalyticsStats appId="demo" />)
    expect(within(grid()).getByText("3")).toBeInTheDocument()
    expect(screen.getByText("open")).toBeInTheDocument()
    expect(screen.getByText("click")).toBeInTheDocument()
  })

  it("demo mode records an event and refreshes stats", async () => {
    const user = userEvent.setup()
    render(<AppAnalyticsStats appId="demo2" demo />)

    await user.click(screen.getByRole("button", { name: "Record a demo event" }))
    // Total events and event-types both read "1" after the first event.
    expect(within(grid()).getAllByText("1").length).toBeGreaterThan(0)
    expect(screen.getByText("demo_event")).toBeInTheDocument()
  })
})
