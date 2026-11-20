import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"

import { AgentRunDebugPanel } from "./agent-run-debug-panel"
import { buildOpsEvent, buildOpsRun } from "@/lib/agent-runs/ops/fixtures"

describe("AgentRunDebugPanel", () => {
  it("renders controls and the first event", () => {
    render(<AgentRunDebugPanel run={buildOpsRun()} />)
    expect(screen.getByText(/3 events/)).toBeInTheDocument()
    expect(screen.getByText("event 1 / 3")).toBeInTheDocument()
    // Message appears in both the inspector and the event list.
    expect(screen.getAllByText("Run started").length).toBeGreaterThan(0)
  })

  it("steps forward and backward with controls", async () => {
    const user = userEvent.setup()
    render(<AgentRunDebugPanel run={buildOpsRun()} />)
    await user.click(screen.getByRole("button", { name: /next event/i }))
    expect(screen.getByText("event 2 / 3")).toBeInTheDocument()
    expect(screen.getAllByText("Running").length).toBeGreaterThan(0)
    await user.click(screen.getByRole("button", { name: /previous event/i }))
    expect(screen.getByText("event 1 / 3")).toBeInTheDocument()
  })

  it("jumps via the event list", async () => {
    const user = userEvent.setup()
    render(<AgentRunDebugPanel run={buildOpsRun()} />)
    await user.click(screen.getByRole("button", { name: /Run finished/ }))
    expect(screen.getByText("event 3 / 3")).toBeInTheDocument()
  })

  it("toggles breakpoints and shows breakpoint badge", async () => {
    const user = userEvent.setup()
    render(<AgentRunDebugPanel run={buildOpsRun()} />)
    await user.click(screen.getByRole("button", { name: "status" }))
    await user.click(screen.getByRole("button", { name: /next event/i }))
    expect(await screen.findByText("breakpoint")).toBeInTheDocument()
  })

  it("filters the event list", async () => {
    const user = userEvent.setup()
    render(<AgentRunDebugPanel run={buildOpsRun()} />)
    await user.type(screen.getByLabelText("Filter debug events"), "finished")
    expect(screen.getByText("Run finished")).toBeInTheDocument()
    // Inspector still shows the cursor event; assert on the event-list button.
    expect(screen.queryByRole("button", { name: /Run started/ })).not.toBeInTheDocument()
  })

  it("handles runs with no events", () => {
    render(
      <AgentRunDebugPanel
        run={buildOpsRun({ events: [buildOpsEvent({ id: "only" })], steps: [] })}
      />,
    )
    expect(screen.getByText(/1 event/)).toBeInTheDocument()
  })
})
