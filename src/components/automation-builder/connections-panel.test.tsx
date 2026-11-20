import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { addEdgeToGraph, addNodeToGraph, createEmptyGraph } from "@/lib/automation-graph"
import type { AutomationGraph, ConnectionResult } from "@/lib/automation-graph"

import { ConnectionsPanel } from "./connections-panel"

function buildGraph(): AutomationGraph {
  let graph = createEmptyGraph("Pipeline")
  graph = addNodeToGraph(graph, "trigger.schedule", { x: 0, y: 0 })
  graph = addNodeToGraph(graph, "transform", { x: 300, y: 0 })
  return graph
}

function renderPanel(
  graph: AutomationGraph,
  overrides?: Partial<Parameters<typeof ConnectionsPanel>[0]>,
) {
  const onSelectEdge = vi.fn()
  const onConnectAttempt = vi.fn((_conn: unknown): ConnectionResult => ({ ok: true }))
  const onRemoveEdge = vi.fn()
  render(
    <ConnectionsPanel
      graph={graph}
      selectedEdgeId={null}
      onSelectEdge={onSelectEdge}
      onConnectAttempt={onConnectAttempt}
      onRemoveEdge={onRemoveEdge}
      {...overrides}
    />,
  )
  return { onSelectEdge, onConnectAttempt, onRemoveEdge }
}

describe("ConnectionsPanel", () => {
  it("prompts for ports before attempting a connection", async () => {
    const user = userEvent.setup()
    const { onConnectAttempt } = renderPanel(buildGraph())

    await user.click(screen.getByRole("button", { name: "Connect nodes" }))
    expect(onConnectAttempt).not.toHaveBeenCalled()
    expect(screen.getByRole("alert")).toHaveTextContent("Choose a source and target port first.")
  })

  it("connects nodes via the dropdowns", async () => {
    const user = userEvent.setup()
    const graph = buildGraph()
    const { onConnectAttempt } = renderPanel(graph)

    await user.selectOptions(screen.getByLabelText("From node"), graph.nodes[0].id)
    await user.selectOptions(screen.getByLabelText("Output port"), "out")
    await user.selectOptions(screen.getByLabelText("To node"), graph.nodes[1].id)
    await user.selectOptions(screen.getByLabelText("Input port"), "in")
    await user.click(screen.getByRole("button", { name: "Connect nodes" }))

    expect(onConnectAttempt).toHaveBeenCalledWith({
      sourceNodeId: graph.nodes[0].id,
      sourcePort: "out",
      targetNodeId: graph.nodes[1].id,
      targetPort: "in",
    })
    expect(await screen.findByRole("status")).toHaveTextContent("Connection added.")
  })

  it("surfaces the rejection reason when the connection fails", async () => {
    const user = userEvent.setup()
    const graph = buildGraph()
    renderPanel(graph, {
      onConnectAttempt: () => ({ ok: false, reason: "That would create a cycle." }),
    })

    await user.selectOptions(screen.getByLabelText("From node"), graph.nodes[0].id)
    await user.selectOptions(screen.getByLabelText("Output port"), "out")
    await user.selectOptions(screen.getByLabelText("To node"), graph.nodes[1].id)
    await user.selectOptions(screen.getByLabelText("Input port"), "in")
    await user.click(screen.getByRole("button", { name: "Connect nodes" }))

    expect(await screen.findByRole("alert")).toHaveTextContent("That would create a cycle.")
  })

  it("lists edges and supports selection and removal", async () => {
    const user = userEvent.setup()
    const graph = buildGraph()
    const connected = addEdgeToGraph(graph, {
      sourceNodeId: graph.nodes[0].id,
      sourcePort: "out",
      targetNodeId: graph.nodes[1].id,
      targetPort: "in",
    })
    const { onSelectEdge, onRemoveEdge } = renderPanel(connected, {
      selectedEdgeId: connected.edges[0].id,
    })

    const edgeButton = screen.getByRole("button", {
      name: `Edge from ${graph.nodes[0].label} to ${graph.nodes[1].label}`,
    })
    expect(edgeButton).toHaveAttribute("aria-pressed", "true")
    await user.click(edgeButton)
    expect(onSelectEdge).toHaveBeenCalledWith(null)

    await user.click(screen.getByRole("button", { name: "Delete connection" }))
    expect(onRemoveEdge).toHaveBeenCalledWith(connected.edges[0].id)
  })

  it("shows an empty state when there are no edges", () => {
    renderPanel(buildGraph())
    expect(screen.getByText("No connections yet.")).toBeInTheDocument()
  })

  it("only offers nodes that have matching ports", () => {
    const graph = buildGraph()
    // transform has no outputs needed here; add an action which has both.
    const g2 = addNodeToGraph(graph, "action.post-summary", { x: 600, y: 0 })
    renderPanel(g2)

    // From-node options should include the trigger and transform (outputs),
    // and exclude nothing with inputs for the target list.
    const fromSelect = screen.getByLabelText("From node")
    const options = Array.from(fromSelect.querySelectorAll("option")).map((o) => o.textContent)
    expect(options).toContain(graph.nodes[0].label)
    expect(options).toContain(graph.nodes[1].label)
  })
})
