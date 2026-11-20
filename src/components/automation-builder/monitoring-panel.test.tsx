import { render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it } from "vitest"

import {
  addEdgeToGraph,
  addNodeToGraph,
  createEmptyGraph,
  dryRunGraph,
  recordAutomationRun,
} from "@/lib/automation-graph"

import { MonitoringPanel } from "./monitoring-panel"

function graph() {
  let g = createEmptyGraph("Mon")
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

beforeEach(() => window.localStorage.clear())

describe("MonitoringPanel", () => {
  it("shows an empty state with no runs", () => {
    render(<MonitoringPanel scope="mon-empty" />)
    expect(screen.getByText(/No runs recorded yet/)).toBeInTheDocument()
  })

  it("shows metrics after runs are recorded", () => {
    const g = graph()
    recordAutomationRun("mon-1", g, dryRunGraph(g))
    recordAutomationRun("mon-1", g, dryRunGraph(g))
    render(<MonitoringPanel scope="mon-1" />)

    expect(screen.getByText("2")).toBeInTheDocument() // total runs
    expect(screen.getByText("100%")).toBeInTheDocument() // success rate
    expect(screen.getByText(/Last run:/)).toBeInTheDocument()
    expect(screen.getAllByText("Mon").length).toBeGreaterThan(0)
  })
})
