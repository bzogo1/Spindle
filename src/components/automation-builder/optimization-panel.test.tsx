import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { addEdgeToGraph, addNodeToGraph, createEmptyGraph } from "@/lib/automation-graph"

import { OptimizationPanel } from "./optimization-panel"

function graphWithOrphan() {
  let g = createEmptyGraph("Opt")
  g = addNodeToGraph(g, "trigger.schedule", { x: 0, y: 0 })
  g = addNodeToGraph(g, "transform", { x: 200, y: 0 }) // identity → bypassable
  g = addNodeToGraph(g, "action.post-summary", { x: 400, y: 0 })
  g = addEdgeToGraph(g, {
    sourceNodeId: g.nodes[0].id,
    sourcePort: "out",
    targetNodeId: g.nodes[1].id,
    targetPort: "in",
  })
  g = addEdgeToGraph(g, {
    sourceNodeId: g.nodes[1].id,
    sourcePort: "out",
    targetNodeId: g.nodes[2].id,
    targetPort: "in",
  })
  g = addNodeToGraph(g, "agent.task", { x: 600, y: 0 }) // unreachable
  return g
}

describe("OptimizationPanel", () => {
  it("lists suggestions and applies fixes", async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    render(<OptimizationPanel graph={graphWithOrphan()} onApply={onApply} />)

    expect(screen.getByText(/is unreachable/)).toBeInTheDocument()
    expect(screen.getByText(/does nothing/)).toBeInTheDocument()

    const applyButtons = screen.getAllByRole("button", { name: "Apply" })
    expect(applyButtons.length).toBeGreaterThanOrEqual(2)
    await user.click(applyButtons[0])
    expect(onApply).toHaveBeenCalledTimes(1)
    const next = onApply.mock.calls[0][0]
    expect(next.nodes.length).toBeLessThan(4)
  })

  it("shows a clean state for optimized graphs", () => {
    let g = createEmptyGraph("Clean")
    g = addNodeToGraph(g, "trigger.schedule", { x: 0, y: 0 })
    g = addNodeToGraph(g, "action.log", { x: 200, y: 0 })
    g = {
      ...g,
      nodes: g.nodes.map((n, i) =>
        i === 1 ? { ...n, config: { ...n.config, message: "ok" } } : n,
      ),
    }
    g = addEdgeToGraph(g, {
      sourceNodeId: g.nodes[0].id,
      sourcePort: "out",
      targetNodeId: g.nodes[1].id,
      targetPort: "in",
    })
    render(<OptimizationPanel graph={g} onApply={vi.fn()} />)
    // action.log is a sink action → no dead-branch; trigger→action direct is fine for optimizer.
    expect(screen.queryByText(/is unreachable/)).not.toBeInTheDocument()
  })
})
