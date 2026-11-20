import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import {
  addEdgeToGraph,
  addNodeToGraph,
  createEmptyGraph,
  updateNode,
} from "@/lib/automation-graph"

import { SecurityPanel } from "./security-panel"

describe("SecurityPanel", () => {
  it("shows a clean state for a safe graph", () => {
    let g = createEmptyGraph("Safe")
    g = addNodeToGraph(g, "trigger.schedule", { x: 0, y: 0 })
    g = addNodeToGraph(g, "condition", { x: 200, y: 0 })
    g = addNodeToGraph(g, "action.log", { x: 400, y: 0 })
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
    render(<SecurityPanel graph={g} />)
    expect(screen.getByText("Clean")).toBeInTheDocument()
    expect(screen.getByText("No security findings.")).toBeInTheDocument()
  })

  it("lists findings with severities", () => {
    let g = createEmptyGraph("Risky")
    g = addNodeToGraph(g, "trigger.event", { x: 0, y: 0 })
    g = addNodeToGraph(g, "action.post-summary", { x: 200, y: 0 })
    g = updateNode(g, g.nodes[1].id, {
      config: { channel: "#x", apiKey: "sk-aaaaaaaaaaaaaaaaaaaa" },
    })
    g = addEdgeToGraph(g, {
      sourceNodeId: g.nodes[0].id,
      sourcePort: "out",
      targetNodeId: g.nodes[1].id,
      targetPort: "in",
    })
    render(<SecurityPanel graph={g} />)

    expect(screen.getAllByText(/critical/).length).toBeGreaterThan(0)
    expect(screen.getByText("Possible secret in node config")).toBeInTheDocument()
    expect(screen.getByText("Unvalidated event input")).toBeInTheDocument()
  })
})
