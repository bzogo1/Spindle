import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import {
  addEdgeToGraph,
  addNodeToGraph,
  createEmptyGraph,
  updateNode,
} from "@/lib/automation-graph"

import { CompliancePanel } from "./compliance-panel"

function gatedGraph() {
  let g = createEmptyGraph("Compliant")
  g = addNodeToGraph(g, "trigger.event", { x: 0, y: 0 })
  g = addNodeToGraph(g, "condition", { x: 200, y: 0 })
  g = addNodeToGraph(g, "action.log", { x: 400, y: 0 })
  g = addNodeToGraph(g, "action.post-summary", { x: 600, y: 0 })
  g = updateNode(g, g.nodes[2].id, { config: { message: "done", level: "info" } })
  g = addEdgeToGraph(g, {
    sourceNodeId: g.nodes[0].id,
    sourcePort: "out",
    targetNodeId: g.nodes[1].id,
    targetPort: "in",
  })
  g = addEdgeToGraph(g, {
    sourceNodeId: g.nodes[1].id,
    sourcePort: "true",
    targetNodeId: g.nodes[2].id,
    targetPort: "in",
  })
  g = addEdgeToGraph(g, {
    sourceNodeId: g.nodes[2].id,
    sourcePort: "out",
    targetNodeId: g.nodes[3].id,
    targetPort: "in",
  })
  return g
}

describe("CompliancePanel", () => {
  it("shows ready-to-publish for a compliant graph", () => {
    render(<CompliancePanel graph={gatedGraph()} />)
    expect(screen.getByText("Ready to publish")).toBeInTheDocument()
    expect(screen.getByText("Graph has a trigger")).toBeInTheDocument()
    expect(screen.getByText("Actions behind an approval/condition gate")).toBeInTheDocument()
  })

  it("blocks publishing when checks fail", () => {
    let g = createEmptyGraph("Bad")
    g = addNodeToGraph(g, "action.post-summary", { x: 0, y: 0 })
    render(<CompliancePanel graph={g} />)
    expect(screen.getByText(/Blocked · \d+ failing check/)).toBeInTheDocument()
  })
})
