import { getNodeType, isTriggerType } from "./registry"
import { addEdgeToGraph, incomingEdges, outgoingEdges, removeNodeFromGraph } from "./graph"
import type { AutomationGraph, GraphNode } from "./types"

/**
 * Static-analysis suggestions for the automation graph: dead weight, redundant
 * steps, and cheap structural wins. `applyOptimization` performs the safe,
 * mechanical fixes; informational suggestions have no auto-fix.
 */

export type OptimizationKind =
  | "unused-node"
  | "unreachable-node"
  | "redundant-transform"
  | "sequential-transforms"
  | "dead-branch"
  | "duplicate-node"

export type OptimizationFix = "remove-nodes" | "bypass-node"

export interface OptimizationSuggestion {
  id: string
  kind: OptimizationKind
  severity: "info" | "warning"
  title: string
  detail: string
  nodeIds: string[]
  /** Present when the suggestion can be applied automatically. */
  fix?: OptimizationFix
}

function reachableFromTriggers(graph: AutomationGraph): Set<string> {
  const reachable = new Set<string>()
  const queue = graph.nodes.filter((n) => isTriggerType(n.type)).map((n) => n.id)
  const adj = new Map<string, string[]>()
  for (const edge of graph.edges) {
    adj.set(edge.sourceNodeId, [...(adj.get(edge.sourceNodeId) ?? []), edge.targetNodeId])
  }
  for (const id of queue) reachable.add(id)
  const bfs = [...reachable]
  while (bfs.length > 0) {
    const current = bfs.shift()!
    for (const next of adj.get(current) ?? []) {
      if (!reachable.has(next)) {
        reachable.add(next)
        bfs.push(next)
      }
    }
  }
  return reachable
}

function isIdentityTransform(node: GraphNode): boolean {
  return (
    node.type === "transform" &&
    (node.config.operation === undefined || node.config.operation === "identity")
  )
}

function nodeSignature(node: GraphNode): string {
  return `${node.type}|${JSON.stringify(node.config)}`
}

/**
 * Analyze the graph and return optimization suggestions, deterministic order:
 * warnings first, then by node count involved.
 */
export function analyzeGraph(graph: AutomationGraph): OptimizationSuggestion[] {
  const suggestions: OptimizationSuggestion[] = []
  const reachable = reachableFromTriggers(graph)
  const byId = new Map(graph.nodes.map((n) => [n.id, n]))

  // Unreachable nodes (no trigger path) — removable.
  for (const node of graph.nodes) {
    if (isTriggerType(node.type)) continue
    if (!reachable.has(node.id)) {
      suggestions.push({
        id: `unused-${node.id}`,
        kind: "unreachable-node",
        severity: "warning",
        title: `"${node.label}" is unreachable`,
        detail: "No path from any trigger reaches this node; it never executes.",
        nodeIds: [node.id],
        fix: "remove-nodes",
      })
    }
  }

  // Nodes with no outgoing edges that aren't "sink-like" actions — informational.
  const SINK_TYPES = new Set(["action.post-summary", "action.update-files", "action.log"])
  for (const node of graph.nodes) {
    if (!reachable.has(node.id)) continue
    if (outgoingEdges(graph, node.id).length > 0) continue
    const category = getNodeType(node.type)?.category
    if (category === "action" || SINK_TYPES.has(node.type)) continue
    suggestions.push({
      id: `dead-end-${node.id}`,
      kind: "dead-branch",
      severity: "info",
      title: `"${node.label}" leads nowhere`,
      detail: "This node's output is not connected to any downstream node.",
      nodeIds: [node.id],
    })
  }

  // Identity transforms are pure pass-throughs — safe to bypass.
  for (const node of graph.nodes) {
    if (!isIdentityTransform(node) || !reachable.has(node.id)) continue
    suggestions.push({
      id: `identity-${node.id}`,
      kind: "redundant-transform",
      severity: "info",
      title: `"${node.label}" does nothing`,
      detail: "An identity transform passes its input through unchanged; it can be bypassed.",
      nodeIds: [node.id],
      fix: "bypass-node",
    })
  }

  // Chains of two or more non-identity transforms — merge candidate (info only).
  const transformChains: GraphNode[][] = []
  for (const node of graph.nodes) {
    if (node.type !== "transform" || isIdentityTransform(node) || !reachable.has(node.id)) continue
    // Only report the head of a chain to avoid duplicates.
    const incoming = incomingEdges(graph, node.id)
    const hasTransformPredecessor = incoming.some((edge) => {
      const source = byId.get(edge.sourceNodeId)
      return source?.type === "transform" && !isIdentityTransform(source)
    })
    if (hasTransformPredecessor) continue
    const chain = [node]
    let cursor = node
    for (;;) {
      const nextEdge = outgoingEdges(graph, cursor.id).find((edge) => {
        const target = byId.get(edge.targetNodeId)
        return target?.type === "transform" && !isIdentityTransform(target)
      })
      const next = nextEdge ? byId.get(nextEdge.targetNodeId) : undefined
      if (!next) break
      chain.push(next)
      cursor = next
    }
    if (chain.length >= 2) transformChains.push(chain)
  }
  for (const chain of transformChains) {
    suggestions.push({
      id: `chain-${chain[0].id}`,
      kind: "sequential-transforms",
      severity: "info",
      title: `${chain.length} transforms run back-to-back`,
      detail: `"${chain.map((n) => n.label).join('" → "')}" could be merged into a single transform step.`,
      nodeIds: chain.map((n) => n.id),
    })
  }

  // Duplicate nodes: same type + config appearing more than once.
  const bySignature = new Map<string, GraphNode[]>()
  for (const node of graph.nodes) {
    if (!reachable.has(node.id)) continue
    const key = nodeSignature(node)
    bySignature.set(key, [...(bySignature.get(key) ?? []), node])
  }
  for (const group of bySignature.values()) {
    if (group.length < 2) continue
    suggestions.push({
      id: `dup-${group[0].id}`,
      kind: "duplicate-node",
      severity: "info",
      title: `${group.length} identical "${group[0].label}" nodes`,
      detail: "These nodes have the same type and configuration; consider consolidating them.",
      nodeIds: group.map((n) => n.id),
    })
  }

  const rank = { warning: 0, info: 1 } as const
  return suggestions.sort(
    (a, b) => rank[a.severity] - rank[b.severity] || b.nodeIds.length - a.nodeIds.length,
  )
}

/**
 * Apply a suggestion's auto-fix to the graph. Returns the graph unchanged for
 * suggestions without a `fix` or for node ids that no longer exist.
 */
export function applyOptimization(
  graph: AutomationGraph,
  suggestion: OptimizationSuggestion,
): AutomationGraph {
  if (!suggestion.fix) return graph
  const existing = new Set(graph.nodes.map((n) => n.id))
  const targets = suggestion.nodeIds.filter((id) => existing.has(id))
  if (targets.length === 0) return graph

  if (suggestion.fix === "remove-nodes") {
    let next = graph
    for (const id of targets) next = removeNodeFromGraph(next, id)
    return next
  }

  // bypass-node: rewire each target's incoming edges to its outgoing targets,
  // then remove the node. Only safe for single-in/single-out chains; nodes
  // with fan-out or fan-in are skipped (the caller re-analyzes anyway).
  let next = graph
  for (const id of targets) {
    const node = next.nodes.find((n) => n.id === id)
    if (!node) continue
    const ins = incomingEdges(next, id)
    const outs = outgoingEdges(next, id)
    if (ins.length !== 1 || outs.length !== 1) continue
    const inEdge = ins[0]
    const outEdge = outs[0]
    // Preserve the downstream target port; the bypassed node is identity.
    const bypassConn = {
      sourceNodeId: inEdge.sourceNodeId,
      sourcePort: inEdge.sourcePort,
      targetNodeId: outEdge.targetNodeId,
      targetPort: outEdge.targetPort,
    }
    try {
      next = addEdgeToGraph(next, bypassConn)
    } catch {
      continue
    }
    next = removeNodeFromGraph(next, id)
  }
  return next
}
