import { fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  addEdgeToGraph,
  addNodeToGraph,
  createEmptyGraph,
  type AutomationGraph,
} from "@/lib/automation-graph"

import { GraphCanvas } from "./graph-canvas"
import { NODE_WIDTH } from "./layout"

function buildGraph(): AutomationGraph {
  let graph = createEmptyGraph("Pipeline")
  graph = addNodeToGraph(graph, "trigger.schedule", { x: 0, y: 0 })
  graph = addNodeToGraph(graph, "transform", { x: 400, y: 0 })
  return graph
}

function renderCanvas(
  graph: AutomationGraph,
  overrides?: Partial<Parameters<typeof GraphCanvas>[0]>,
) {
  const onSelectNode = vi.fn()
  const onSelectEdge = vi.fn()
  const onMoveNode = vi.fn()
  const onConnectAttempt = vi.fn(() => ({ ok: true as const }))
  const onAddNodeAt = vi.fn()
  render(
    <GraphCanvas
      graph={graph}
      selectedNodeId={null}
      selectedEdgeId={null}
      onSelectNode={onSelectNode}
      onSelectEdge={onSelectEdge}
      onMoveNode={onMoveNode}
      onConnectAttempt={onConnectAttempt}
      onAddNodeAt={onAddNodeAt}
      {...overrides}
    />,
  )
  return { onSelectNode, onSelectEdge, onMoveNode, onConnectAttempt, onAddNodeAt }
}

function mockElementFromPoint(element: Element | null) {
  // jsdom does not implement document.elementFromPoint.
  document.elementFromPoint = vi.fn(() => element)
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe("GraphCanvas", () => {
  it("shows the empty state when the graph has no nodes", () => {
    renderCanvas(createEmptyGraph("Empty"))
    expect(screen.getByText("Empty canvas")).toBeInTheDocument()
  })

  it("renders nodes with accessible labels and port buttons", () => {
    const graph = buildGraph()
    renderCanvas(graph)

    expect(screen.getByRole("button", { name: /Node Schedule trigger/ })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Node Transform/ })).toBeInTheDocument()
    expect(
      screen.getByRole("button", {
        name: "Schedule trigger output payload — drag to connect",
      }),
    ).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Transform input in/ })).toBeInTheDocument()
  })

  it("selects a node when clicked", () => {
    const graph = buildGraph()
    const { onSelectNode } = renderCanvas(graph)

    fireEvent.click(screen.getByRole("button", { name: /Node Transform/ }))
    expect(onSelectNode).toHaveBeenCalledWith(graph.nodes[1].id)
  })

  it("clears selection when the canvas background is clicked", () => {
    const graph = buildGraph()
    const { onSelectNode, onSelectEdge } = renderCanvas(graph)

    // Click the scroll container's inner area away from nodes.
    const svg = document.querySelector("svg")!
    fireEvent.click(svg)
    expect(onSelectNode).toHaveBeenCalledWith(null)
    expect(onSelectEdge).toHaveBeenCalledWith(null)
  })

  it("selects an edge when its path is clicked", () => {
    const graph = buildGraph()
    const connected = addEdgeToGraph(graph, {
      sourceNodeId: graph.nodes[0].id,
      sourcePort: "out",
      targetNodeId: graph.nodes[1].id,
      targetPort: "in",
    })
    const { onSelectEdge } = renderCanvas(connected)

    const path = document.querySelector("svg path")!
    fireEvent.click(path)
    expect(onSelectEdge).toHaveBeenCalledWith(connected.edges[0].id)
  })

  it("moves a node by dragging its header", () => {
    const graph = buildGraph()
    const node = graph.nodes[0]
    const { onMoveNode, onSelectNode } = renderCanvas(graph)

    const header = screen
      .getByRole("button", { name: /Node Schedule trigger/ })
      .querySelector("div")!

    fireEvent.pointerDown(header, {
      pointerId: 1,
      button: 0,
      clientX: node.position.x + 10,
      clientY: node.position.y + 10,
    })
    expect(onSelectNode).toHaveBeenCalledWith(node.id)

    fireEvent.pointerMove(header, {
      pointerId: 1,
      clientX: node.position.x + 60,
      clientY: node.position.y + 40,
    })
    // dx = clientX - node.position.x at drag start = 10 → new x = 60 - 10 = 50... wait:
    // onMove receives { x: clientX - dx, y: clientY - dy } = {60-10, 40-10} = {50, 30}
    expect(onMoveNode).toHaveBeenCalledWith(node.id, { x: 50, y: 30 })

    fireEvent.pointerUp(header, { pointerId: 1 })
  })

  it("adds a node at the drop position when a palette payload is dropped", () => {
    const graph = buildGraph()
    const { onAddNodeAt } = renderCanvas(graph)

    const inner = document.querySelector<HTMLElement>("[style*='width']")!
    const dataTransfer = {
      getData: vi.fn(() => "transform"),
      setData: vi.fn(),
      effectAllowed: "",
    }
    // jsdom has no DragEvent; build a drop event carrying client coords + payload.
    const dropEvent = new Event("drop", { bubbles: true, cancelable: true })
    Object.defineProperty(dropEvent, "clientX", { value: 200 })
    Object.defineProperty(dropEvent, "clientY", { value: 100 })
    Object.defineProperty(dropEvent, "dataTransfer", { value: dataTransfer })
    inner.dispatchEvent(dropEvent)

    // jsdom getBoundingClientRect returns zeros, so position = client - half width.
    expect(onAddNodeAt).toHaveBeenCalledWith("transform", {
      x: 200 - NODE_WIDTH / 2,
      y: 100 - 24,
    })
  })

  it("ignores drops without a node payload", () => {
    const graph = buildGraph()
    const { onAddNodeAt } = renderCanvas(graph)

    const inner = document.querySelector<HTMLElement>("[style*='width']")!
    const dataTransfer = { getData: vi.fn(() => ""), setData: vi.fn() }
    fireEvent.drop(inner, { clientX: 10, clientY: 10, dataTransfer })
    expect(onAddNodeAt).not.toHaveBeenCalled()
  })

  it("completes a connection when an output port drag ends on an input port", () => {
    const graph = buildGraph()
    const { onConnectAttempt } = renderCanvas(graph)

    const outPort = screen.getByRole("button", {
      name: "Schedule trigger output payload — drag to connect",
    })
    fireEvent.pointerDown(outPort, { pointerId: 7, button: 0 })

    // The status bar shows the pending-connection hint.
    expect(screen.getByText(/Drag from the output port/)).toBeInTheDocument()

    const inPort = screen.getByRole("button", { name: /Transform input in/ })
    mockElementFromPoint(inPort)
    fireEvent.pointerUp(window, { pointerId: 7, clientX: 10, clientY: 10 })

    expect(onConnectAttempt).toHaveBeenCalledWith({
      sourceNodeId: graph.nodes[0].id,
      sourcePort: "out",
      targetNodeId: graph.nodes[1].id,
      targetPort: "in",
    })
  })

  it("cancels a pending connection with Escape", () => {
    const graph = buildGraph()
    renderCanvas(graph)

    const outPort = screen.getByRole("button", {
      name: "Schedule trigger output payload — drag to connect",
    })
    fireEvent.pointerDown(outPort, { pointerId: 7, button: 0 })
    expect(screen.getByText(/Drag from the output port/)).toBeInTheDocument()

    fireEvent.keyDown(window, { key: "Escape" })
    expect(
      screen.getByText(/Drag from an output port \(right\) to an input port/),
    ).toBeInTheDocument()
  })

  it("shows the rejection reason when a connection attempt fails", () => {
    const graph = buildGraph()
    renderCanvas(graph, {
      onConnectAttempt: () => ({ ok: false, reason: "That would create a cycle." }),
    })

    const outPort = screen.getByRole("button", {
      name: "Schedule trigger output payload — drag to connect",
    })
    fireEvent.pointerDown(outPort, { pointerId: 7, button: 0 })

    const inPort = screen.getByRole("button", { name: /Transform input in/ })
    mockElementFromPoint(inPort)
    fireEvent.pointerUp(window, { pointerId: 7, clientX: 10, clientY: 10 })

    expect(screen.getByRole("alert")).toHaveTextContent("That would create a cycle.")

    fireEvent.click(screen.getByRole("button", { name: "Dismiss connection error" }))
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  })

  it("does not start a connection from a non-primary button", () => {
    const graph = buildGraph()
    renderCanvas(graph)

    const outPort = screen.getByRole("button", {
      name: "Schedule trigger output payload — drag to connect",
    })
    fireEvent.pointerDown(outPort, { pointerId: 7, button: 2 })
    expect(screen.queryByText(/Drag from the output port/)).not.toBeInTheDocument()
  })

  it("renders run statuses on nodes", () => {
    const graph = buildGraph()
    renderCanvas(graph, {
      statuses: { [graph.nodes[0].id]: "success" },
      errorNodeIds: new Set([graph.nodes[1].id]),
    })
    expect(screen.getByText("success")).toBeInTheDocument()
  })

  it("renders collaborator presence pills and comment badges on nodes", () => {
    const graph = buildGraph()
    renderCanvas(graph, {
      peerSelections: new Map([[graph.nodes[0].id, [{ name: "Maya", color: "#f00" }]]]),
      commentCounts: { [graph.nodes[1].id]: 2 },
    })

    expect(screen.getByText("Maya")).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: /Node Schedule trigger.*also viewed by Maya/ }),
    ).toBeInTheDocument()
    expect(screen.getByLabelText("2 comments")).toBeInTheDocument()
  })

  it("marks warning nodes with an amber border, error nodes with a destructive one", () => {
    const graph = buildGraph()
    renderCanvas(graph, {
      errorNodeIds: new Set([graph.nodes[0].id]),
      warningNodeIds: new Set([graph.nodes[1].id]),
    })

    expect(screen.getByRole("button", { name: /Node Schedule trigger/ })).toHaveClass(
      "border-destructive/70",
    )
    const transform = screen.getByRole("button", { name: /Node Transform/ })
    expect(transform).toHaveClass("border-amber-500/70")
    expect(transform).not.toHaveClass("border-destructive/70")
  })
})
