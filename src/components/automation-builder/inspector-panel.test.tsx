import { fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { addNodeToGraph, createEmptyGraph } from "@/lib/automation-graph"

import { InspectorPanel } from "./inspector-panel"

function renderWithNode(type: string) {
  let graph = createEmptyGraph("Test")
  graph = addNodeToGraph(graph, type, { x: 0, y: 0 })
  const node = graph.nodes[0]
  return { node, ...renderWithNodeRaw(node) }
}

function renderWithNodeRaw(node: Parameters<typeof InspectorPanel>[0]["node"]) {
  const onUpdateNode = vi.fn()
  const onDeleteNode = vi.fn()
  render(<InspectorPanel node={node} onUpdateNode={onUpdateNode} onDeleteNode={onDeleteNode} />)
  return { onUpdateNode, onDeleteNode }
}

describe("InspectorPanel", () => {
  it("shows a hint when no node is selected", () => {
    renderWithNodeRaw(null)
    expect(screen.getByText("Inspector")).toBeInTheDocument()
    expect(
      screen.getByText("Select a node on the canvas to edit its configuration."),
    ).toBeInTheDocument()
  })

  it("shows the node label, delete button, and port summary", () => {
    const { node } = renderWithNode("trigger.schedule")
    expect(screen.getByText("Schedule trigger")).toBeInTheDocument()
    expect(screen.getByLabelText(`Delete node ${node.label}`)).toBeInTheDocument()
    expect(screen.getByText(/Inputs: none/)).toBeInTheDocument()
    expect(screen.getByText(/Outputs:/)).toBeInTheDocument()
  })

  it("calls onDeleteNode with the node id", async () => {
    const user = userEvent.setup()
    const { node, onDeleteNode } = renderWithNode("transform")
    await user.click(screen.getByLabelText(`Delete node ${node.label}`))
    expect(onDeleteNode).toHaveBeenCalledWith(node.id)
  })

  it("edits the node label", () => {
    const { node, onUpdateNode } = renderWithNode("transform")
    const input = screen.getByLabelText("Label")
    fireEvent.change(input, { target: { value: "My transform" } })
    expect(onUpdateNode).toHaveBeenCalledWith(node.id, { label: "My transform" })
  })

  it("renders text and textarea config fields and forwards changes", () => {
    const { node, onUpdateNode } = renderWithNode("trigger.schedule")

    const cron = screen.getByLabelText(/Cron expression/)
    fireEvent.change(cron, { target: { value: "*/5 * * * *" } })
    expect(onUpdateNode).toHaveBeenCalledWith(node.id, {
      config: expect.objectContaining({ cron: "*/5 * * * *" }),
    })

    const payload = screen.getByLabelText(/Sample payload/)
    fireEvent.change(payload, { target: { value: '{"a":1}' } })
    expect(onUpdateNode).toHaveBeenCalledWith(node.id, {
      config: expect.objectContaining({ payload: '{"a":1}' }),
    })
  })

  it("renders select config fields with their options", async () => {
    const user = userEvent.setup()
    const { node, onUpdateNode } = renderWithNode("transform")

    const select = screen.getByLabelText("Operation")
    expect(select.tagName).toBe("SELECT")
    await user.selectOptions(select, "uppercase")
    expect(onUpdateNode).toHaveBeenCalledWith(node.id, {
      config: expect.objectContaining({ operation: "uppercase" }),
    })
  })

  it("renders boolean config fields as switches", async () => {
    const user = userEvent.setup()
    const { node, onUpdateNode } = renderWithNode("action.post-summary")

    const toggle = screen.getByRole("switch")
    expect(toggle).toHaveAttribute("aria-checked", "false")
    await user.click(toggle)
    expect(onUpdateNode).toHaveBeenCalledWith(node.id, {
      config: expect.objectContaining({ simulateError: true }),
    })
  })

  it("shows a fallback for node types with no config fields", () => {
    // Every registry type has config fields, so craft a node with an unknown type.
    const node = {
      id: "n1",
      type: "custom.unknown",
      label: "Custom",
      config: {},
      position: { x: 0, y: 0 },
    }
    renderWithNodeRaw(node)
    // Unknown types fall back to the raw type key for the heading.
    expect(screen.getByText("custom.unknown")).toBeInTheDocument()
    expect(screen.getByText("This node type has no configuration.")).toBeInTheDocument()
    expect(screen.getByText(/Inputs: none/)).toBeInTheDocument()
  })
})
