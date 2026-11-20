import { getNodeType } from "./registry"
import type { AutomationGraph, GraphEdge, GraphNode } from "./types"

/**
 * Structural diff between two versions of an automation graph. Used by the
 * version-history panel to show what changed between snapshots and by the
 * marketplace/restore flows to summarize edits.
 *
 * Nodes are matched by id; edges are matched by id as well (edge ids are
 * stable within a graph's lifetime, so added/removed edges map cleanly).
 */

export interface FieldChange {
  field: string
  before: unknown
  after: unknown
}

export interface NodeChange {
  nodeId: string
  label: string
  type: string
  changes: FieldChange[]
}

export interface GraphDiff {
  addedNodes: GraphNode[]
  removedNodes: GraphNode[]
  /** Nodes present in both graphs whose label/type/config/position changed. */
  changedNodes: NodeChange[]
  addedEdges: GraphEdge[]
  removedEdges: GraphEdge[]
  /** True when the graphs are structurally identical. */
  unchanged: boolean
}

/** Recursively sort object keys so stringify output is key-order stable. */
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => [key, sortKeys((value as Record<string, unknown>)[key])]),
    )
  }
  return value
}

function stable(value: unknown): string {
  try {
    return JSON.stringify(sortKeys(value) ?? null)
  } catch {
    return String(value)
  }
}

function nodeChanges(before: GraphNode, after: GraphNode): FieldChange[] {
  const changes: FieldChange[] = []
  if (before.label !== after.label) {
    changes.push({ field: "label", before: before.label, after: after.label })
  }
  if (before.type !== after.type) {
    changes.push({ field: "type", before: before.type, after: after.type })
  }
  if (stable(before.config) !== stable(after.config)) {
    changes.push({ field: "config", before: before.config, after: after.config })
  }
  if (before.position.x !== after.position.x || before.position.y !== after.position.y) {
    changes.push({
      field: "position",
      before: before.position,
      after: after.position,
    })
  }
  return changes
}

/**
 * Diff `before` → `after`. `before` is the older graph; additions and
 * removals are reported from its perspective.
 */
export function diffGraphs(before: AutomationGraph, after: AutomationGraph): GraphDiff {
  const beforeNodes = new Map(before.nodes.map((node) => [node.id, node]))
  const afterNodes = new Map(after.nodes.map((node) => [node.id, node]))
  const beforeEdges = new Map(before.edges.map((edge) => [edge.id, edge]))
  const afterEdges = new Map(after.edges.map((edge) => [edge.id, edge]))

  const addedNodes = after.nodes.filter((node) => !beforeNodes.has(node.id))
  const removedNodes = before.nodes.filter((node) => !afterNodes.has(node.id))

  const changedNodes: NodeChange[] = []
  for (const node of after.nodes) {
    const previous = beforeNodes.get(node.id)
    if (!previous) continue
    const changes = nodeChanges(previous, node)
    if (changes.length > 0) {
      changedNodes.push({
        nodeId: node.id,
        label: node.label,
        type: node.type,
        changes,
      })
    }
  }

  const addedEdges = after.edges.filter((edge) => !beforeEdges.has(edge.id))
  const removedEdges = before.edges.filter((edge) => !afterEdges.has(edge.id))

  return {
    addedNodes,
    removedNodes,
    changedNodes,
    addedEdges,
    removedEdges,
    unchanged:
      addedNodes.length === 0 &&
      removedNodes.length === 0 &&
      changedNodes.length === 0 &&
      addedEdges.length === 0 &&
      removedEdges.length === 0,
  }
}

export interface DiffSummary {
  added: number
  removed: number
  changed: number
  edgesAdded: number
  edgesRemoved: number
}

/** Compact counts for list UIs. */
export function summarizeDiff(diff: GraphDiff): DiffSummary {
  return {
    added: diff.addedNodes.length,
    removed: diff.removedNodes.length,
    changed: diff.changedNodes.length,
    edgesAdded: diff.addedEdges.length,
    edgesRemoved: diff.removedEdges.length,
  }
}

/** One-line human description, e.g. "+2 nodes, ~1 changed, +1 edge". */
export function describeDiff(diff: GraphDiff): string {
  if (diff.unchanged) return "No changes"
  const parts: string[] = []
  if (diff.addedNodes.length)
    parts.push(`+${diff.addedNodes.length} node${diff.addedNodes.length === 1 ? "" : "s"}`)
  if (diff.removedNodes.length)
    parts.push(`−${diff.removedNodes.length} node${diff.removedNodes.length === 1 ? "" : "s"}`)
  if (diff.changedNodes.length) parts.push(`~${diff.changedNodes.length} changed`)
  if (diff.addedEdges.length)
    parts.push(`+${diff.addedEdges.length} edge${diff.addedEdges.length === 1 ? "" : "s"}`)
  if (diff.removedEdges.length)
    parts.push(`−${diff.removedEdges.length} edge${diff.removedEdges.length === 1 ? "" : "s"}`)
  return parts.join(", ")
}

/** Resolve a node id to a display label, falling back to the type then the id. */
export function nodeLabel(graph: AutomationGraph, nodeId: string): string {
  const node = graph.nodes.find((candidate) => candidate.id === nodeId)
  if (!node) return nodeId
  return node.label || getNodeType(node.type)?.label || node.type
}
