import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"

import { addEdgeToGraph, addNodeToGraph, createEmptyGraph } from "@/lib/automation-graph"

import { DebuggerPanel } from "./debugger-panel"

function graph() {
  let g = createEmptyGraph("Debug")
  g = addNodeToGraph(g, "trigger.schedule", { x: 0, y: 0 })
  g = addNodeToGraph(g, "action.post-summary", { x: 200, y: 0 })
  g = addEdgeToGraph(g, {
    sourceNodeId: g.nodes[0].id,
    sourcePort: "out",
    targetNodeId: g.nodes[1].id,
    targetPort: "in",
  })
  return g
}

describe("DebuggerPanel", () => {
  it("steps through nodes and inspects payloads", async () => {
    const user = userEvent.setup()
    render(<DebuggerPanel graph={graph()} />)

    await user.click(screen.getByRole("button", { name: "Start session" }))
    expect(screen.getByText(/Before the first node/)).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Step forward" }))
    expect(screen.getByText("Input payload")).toBeInTheDocument()
    expect(screen.getByText("Output")).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Step forward" }))
    // Second node shows its own inspection; variables inspector appears.
    expect(screen.getByText("Variables")).toBeInTheDocument()
    expect(screen.getByText("2/2")).toBeInTheDocument()
  })

  it("toggles breakpoints and continues to them", async () => {
    const user = userEvent.setup()
    render(<DebuggerPanel graph={graph()} />)

    await user.click(screen.getByRole("button", { name: "Start session" }))
    await user.click(screen.getByRole("button", { name: /Toggle breakpoint on Post run summary/ }))
    await user.click(screen.getByRole("button", { name: "Continue to next breakpoint" }))
    // Jumped straight to node 2 (index 1).
    expect(screen.getByText("2/2")).toBeInTheDocument()
  })

  it("disables start when the graph has errors", () => {
    let g = createEmptyGraph("Bad")
    g = addNodeToGraph(g, "agent.task", { x: 0, y: 0 }) // missing required prompt
    render(<DebuggerPanel graph={g} />)
    expect(screen.getByRole("button", { name: "Start session" })).toBeDisabled()
    expect(screen.getByText(/Fix validation errors/)).toBeInTheDocument()
  })
})
