import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"

import { addEdgeToGraph, addNodeToGraph, createEmptyGraph } from "@/lib/automation-graph"

import { ProfilerPanel } from "./profiler-panel"

function graph() {
  let g = createEmptyGraph("Prof")
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

describe("ProfilerPanel", () => {
  it("profiles a run and shows per-node bars", async () => {
    const user = userEvent.setup()
    render(<ProfilerPanel graph={graph()} />)

    await user.click(screen.getByRole("button", { name: "Profile run" }))

    expect(await screen.findByText(/Total \d+ms/)).toBeInTheDocument()
    expect(screen.getByText("Schedule trigger")).toBeInTheDocument()
    expect(screen.getByText("Post run summary")).toBeInTheDocument()
    expect(screen.getAllByText(/ms · \d+%/).length).toBe(2)
  })

  it("re-runs the profile", async () => {
    const user = userEvent.setup()
    render(<ProfilerPanel graph={graph()} />)
    await user.click(screen.getByRole("button", { name: "Profile run" }))
    await user.click(screen.getByRole("button", { name: "Re-run profile" }))
    expect(screen.getByText(/Total \d+ms/)).toBeInTheDocument()
  })
})
