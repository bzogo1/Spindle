import { describe, expect, it } from "vitest"

import type { GraphNode } from "@/lib/automation-graph"

import {
  CANVAS_MARGIN,
  edgePath,
  NODE_HEADER_HEIGHT,
  NODE_PADDING_BOTTOM,
  NODE_WIDTH,
  nodeHeight,
  nodePortRows,
  PORT_ROW_HEIGHT,
  portAnchor,
  canvasSize,
  type Point,
} from "./layout"

function node(type: string, x = 0, y = 0): GraphNode {
  return {
    id: `${type}-${x}-${y}`,
    type,
    label: type,
    config: {},
    position: { x, y },
  }
}

describe("nodePortRows / nodeHeight", () => {
  it("uses the larger of input/output port counts, minimum one row", () => {
    // trigger.schedule: 0 inputs, 1 output
    expect(nodePortRows(node("trigger.schedule"))).toBe(1)
    // transform: 1 input, 1 output
    expect(nodePortRows(node("transform"))).toBe(1)
    // condition: 1 input, 2 outputs (true/false branches)
    expect(nodePortRows(node("condition"))).toBe(2)
  })

  it("falls back to one row for unknown node types", () => {
    expect(nodePortRows(node("bogus.type"))).toBe(1)
  })

  it("computes height from header, port rows, and bottom padding", () => {
    const single = node("transform", 10, 20)
    expect(nodeHeight(single)).toBe(NODE_HEADER_HEIGHT + PORT_ROW_HEIGHT + NODE_PADDING_BOTTOM)

    const branched = node("condition")
    expect(nodeHeight(branched)).toBe(
      NODE_HEADER_HEIGHT + 2 * PORT_ROW_HEIGHT + NODE_PADDING_BOTTOM,
    )
  })
})

describe("portAnchor", () => {
  it("places input ports on the left edge and output ports on the right edge", () => {
    const n = node("transform", 100, 200)
    const input = portAnchor(n, "in", "in")
    const output = portAnchor(n, "out", "out")

    expect(input.x).toBe(100)
    expect(output.x).toBe(100 + NODE_WIDTH)
  })

  it("centers the first port row inside the header area", () => {
    const n = node("transform", 0, 0)
    expect(portAnchor(n, "in", "in").y).toBe(NODE_HEADER_HEIGHT + PORT_ROW_HEIGHT / 2)
  })

  it("offsets each port row by its index within the direction's port list", () => {
    const n = node("condition", 0, 0)
    const first = portAnchor(n, "true", "out")
    const second = portAnchor(n, "false", "out")

    expect(second.y - first.y).toBe(PORT_ROW_HEIGHT)
    expect(first.y).toBe(NODE_HEADER_HEIGHT + PORT_ROW_HEIGHT / 2)
    expect(second.y).toBe(NODE_HEADER_HEIGHT + PORT_ROW_HEIGHT + PORT_ROW_HEIGHT / 2)
  })

  it("uses independent row indices for inputs and outputs", () => {
    // condition has 1 input and 2 outputs; "in" is index 0 on the left,
    // "false" is index 1 on the right — same y despite different indices.
    const n = node("condition", 0, 0)
    expect(portAnchor(n, "false", "out").y).toBe(portAnchor(n, "in", "in").y + PORT_ROW_HEIGHT)
  })

  it("falls back to the first row for unknown port ids and node types", () => {
    const n = node("transform", 5, 7)
    const fallbackY = NODE_HEADER_HEIGHT + PORT_ROW_HEIGHT / 2
    expect(portAnchor(n, "missing", "in")).toEqual({ x: 5, y: 7 + fallbackY })
    expect(portAnchor(n, "missing", "out")).toEqual({
      x: 5 + NODE_WIDTH,
      y: 7 + fallbackY,
    })

    const unknown = node("bogus.type", 0, 0)
    expect(portAnchor(unknown, "whatever", "in").y).toBe(fallbackY)
  })
})

describe("canvasSize", () => {
  it("returns the minimum canvas for an empty graph", () => {
    expect(canvasSize([])).toEqual({ width: 960, height: 560 })
  })

  it("returns the minimum canvas when nodes fit inside it", () => {
    const nodes = [node("transform", 0, 0), node("condition", 300, 100)]
    const size = canvasSize(nodes)
    expect(size.width).toBe(960)
    expect(size.height).toBe(560)
  })

  it("grows to cover the right/bottom extent of nodes plus margin", () => {
    const n = node("transform", 1000, 500)
    const size = canvasSize([n])
    expect(size.width).toBe(1000 + NODE_WIDTH + CANVAS_MARGIN * 2)
    expect(size.height).toBe(500 + nodeHeight(n) + CANVAS_MARGIN * 2)
  })

  it("uses the furthest node when nodes overlap or are staggered", () => {
    const near = node("transform", 0, 0)
    const far = node("condition", 2000, 10)
    const overlapping = node("transform", 1990, 800)
    const size = canvasSize([near, far, overlapping])
    // far: x extent 2000+252, y extent 10+104; overlapping: y extent 800+78
    expect(size.width).toBe(2000 + NODE_WIDTH + CANVAS_MARGIN * 2)
    expect(size.height).toBe(800 + nodeHeight(overlapping) + CANVAS_MARGIN * 2)
  })
})

describe("edgePath", () => {
  const left: Point = { x: 0, y: 0 }
  const right: Point = { x: 200, y: 100 }

  it("starts at the source and ends at the target", () => {
    const d = edgePath(left, right)
    expect(d.startsWith("M 0 0 C ")).toBe(true)
    expect(d.endsWith(`, 200 100`)).toBe(true)
  })

  it("uses a minimum horizontal control offset of 48px", () => {
    // distance 200 → dx = max(48, 100) = 100
    const d = edgePath(left, right)
    expect(d).toBe("M 0 0 C 100 0, 100 100, 200 100")
  })

  it("clamps the control offset to 48px for close nodes", () => {
    const d = edgePath({ x: 0, y: 0 }, { x: 60, y: 0 })
    // dx = max(48, 30) = 48
    expect(d).toBe("M 0 0 C 48 0, 12 0, 60 0")
  })

  it("handles identical points without NaN", () => {
    const d = edgePath(left, { ...left })
    expect(d).toBe("M 0 0 C 48 0, -48 0, 0 0")
    expect(d).not.toContain("NaN")
  })

  it("reverses control-point direction for right-to-left edges", () => {
    const d = edgePath(right, left)
    expect(d).toBe("M 200 100 C 100 100, 100 0, 0 0")
  })

  it("keeps control points on the correct side when only y differs", () => {
    const d = edgePath({ x: 50, y: 0 }, { x: 50, y: 300 })
    // same x → dx = 48, to.x >= from.x → c1x = 98, c2x = 2
    expect(d).toBe("M 50 0 C 98 0, 2 300, 50 300")
  })
})
