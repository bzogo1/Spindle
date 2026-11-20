import { getNodeType } from "@/lib/automation-graph"
import type { GraphNode } from "@/lib/automation-graph"

/**
 * Fixed geometry for canvas nodes. Edge anchors are computed from these
 * constants so SVG paths line up with the port dots rendered in the DOM
 * without needing layout measurement.
 */
export const NODE_WIDTH = 252
export const NODE_HEADER_HEIGHT = 42
export const PORT_ROW_HEIGHT = 26
export const PORT_DOT_SIZE = 12
export const NODE_PADDING_BOTTOM = 10
export const CANVAS_MARGIN = 48

export function nodePortRows(node: GraphNode): number {
  const def = getNodeType(node.type)
  if (!def) return 1
  return Math.max(def.inputs.length, def.outputs.length, 1)
}

export function nodeHeight(node: GraphNode): number {
  return NODE_HEADER_HEIGHT + nodePortRows(node) * PORT_ROW_HEIGHT + NODE_PADDING_BOTTOM
}

export interface Point {
  x: number
  y: number
}

/** Center point of a port dot in canvas coordinates. */
export function portAnchor(node: GraphNode, portId: string, direction: "in" | "out"): Point {
  const def = getNodeType(node.type)
  const ports = direction === "in" ? def?.inputs : def?.outputs
  const found = ports?.findIndex((port) => port.id === portId) ?? -1
  const index = found < 0 ? 0 : found
  const y = node.position.y + NODE_HEADER_HEIGHT + index * PORT_ROW_HEIGHT + PORT_ROW_HEIGHT / 2
  const x = direction === "in" ? node.position.x : node.position.x + NODE_WIDTH
  return { x, y }
}

export function canvasSize(nodes: GraphNode[]): { width: number; height: number } {
  let maxX = 0
  let maxY = 0
  for (const node of nodes) {
    maxX = Math.max(maxX, node.position.x + NODE_WIDTH)
    maxY = Math.max(maxY, node.position.y + nodeHeight(node))
  }
  return {
    width: Math.max(960, maxX + CANVAS_MARGIN * 2),
    height: Math.max(560, maxY + CANVAS_MARGIN * 2),
  }
}

/** Cubic bezier path between two anchor points. */
export function edgePath(from: Point, to: Point): string {
  const dx = Math.max(48, Math.abs(to.x - from.x) / 2)
  const c1x = from.x + (to.x >= from.x ? dx : -dx)
  const c2x = to.x - (to.x >= from.x ? dx : -dx)
  return `M ${from.x} ${from.y} C ${c1x} ${from.y}, ${c2x} ${to.y}, ${to.x} ${to.y}`
}
