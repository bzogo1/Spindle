import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import {
  addEdgeToGraph,
  addNodeToGraph,
  createEmptyGraph,
  type AutomationGraph,
  type DryRunReport,
} from "@/lib/automation-graph"

import { DryRunPanel } from "./dry-run-panel"

function buildGraph(): AutomationGraph {
  let graph = createEmptyGraph("Pipeline")
  graph = addNodeToGraph(graph, "trigger.schedule", { x: 0, y: 0 })
  graph = addNodeToGraph(graph, "transform", { x: 300, y: 0 })
  graph = addEdgeToGraph(graph, {
    sourceNodeId: graph.nodes[0].id,
    sourcePort: "out",
    targetNodeId: graph.nodes[1].id,
    targetPort: "in",
  })
  return graph
}

function renderPanel(
  graph: AutomationGraph,
  overrides?: Partial<Parameters<typeof DryRunPanel>[0]>,
) {
  const onReport = vi.fn()
  const onStatusesChange = vi.fn()
  render(
    <DryRunPanel
      graph={graph}
      report={null}
      onReport={onReport}
      onStatusesChange={onStatusesChange}
      {...overrides}
    />,
  )
  return { onReport, onStatusesChange }
}

describe("DryRunPanel", () => {
  it("shows the empty state and run button", () => {
    renderPanel(buildGraph())
    expect(
      screen.getByText("Simulates the graph with mock inputs — no real side effects."),
    ).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Run dry run" })).toBeEnabled()
  })

  it("runs the dry run and reports results and statuses", async () => {
    const user = userEvent.setup()
    const graph = buildGraph()
    const { onReport, onStatusesChange } = renderPanel(graph)

    await user.click(screen.getByRole("button", { name: "Run dry run" }))

    await waitFor(() => expect(onReport).toHaveBeenCalled())
    const report = onReport.mock.calls[0][0] as DryRunReport
    expect(report.summary.succeeded).toBe(2)
    expect(onStatusesChange).toHaveBeenCalledWith(
      expect.objectContaining({
        [graph.nodes[0].id]: "success",
        [graph.nodes[1].id]: "success",
      }),
    )
  })

  it("renders a provided report with per-node results", () => {
    const graph = buildGraph()
    const report: DryRunReport = {
      graphId: graph.id,
      status: "success",
      issues: [],
      order: graph.nodes.map((n) => n.id),
      summary: { total: 2, succeeded: 1, failed: 0, skipped: 1 },
      results: [
        {
          nodeId: graph.nodes[0].id,
          status: "success",
          startedAtMs: 0,
          durationMs: 3,
          logs: ["tick"],
          output: { hello: "world" },
        },
        {
          nodeId: graph.nodes[1].id,
          status: "skipped",
          startedAtMs: 3,
          durationMs: 0,
          logs: [],
        },
      ],
    }
    renderPanel(graph, { report })

    expect(screen.getAllByText("success").length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText("1 succeeded · 0 failed · 1 skipped")).toBeInTheDocument()
    expect(screen.getByText(graph.nodes[0].label)).toBeInTheDocument()
    expect(screen.getByText("tick")).toBeInTheDocument()
    expect(screen.getByText("Output")).toBeInTheDocument()
  })

  it("clears the report via the Clear button", async () => {
    const user = userEvent.setup()
    const graph = buildGraph()
    const report: DryRunReport = {
      graphId: graph.id,
      status: "success",
      issues: [],
      order: [],
      summary: { total: 0, succeeded: 0, failed: 0, skipped: 0 },
      results: [],
    }
    const { onReport, onStatusesChange } = renderPanel(graph, { report })

    await user.click(screen.getByRole("button", { name: "Clear" }))
    expect(onReport).toHaveBeenCalledWith(null)
    expect(onStatusesChange).toHaveBeenCalledWith({})
  })

  it("disables running while the graph has validation errors", async () => {
    const user = userEvent.setup()
    // Self-loop forces a validation error.
    let graph = createEmptyGraph("Bad")
    graph = addNodeToGraph(graph, "transform", { x: 0, y: 0 })
    graph.edges.push({
      id: "e_bad",
      sourceNodeId: graph.nodes[0].id,
      sourcePort: "out",
      targetNodeId: graph.nodes[0].id,
      targetPort: "in",
    })
    const { onReport } = renderPanel(graph)

    expect(screen.getByRole("button", { name: "Run dry run" })).toBeDisabled()
    expect(screen.getByText("Fix validation errors before running a dry run.")).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Run dry run" }))
    expect(onReport).not.toHaveBeenCalled()
  })
})
