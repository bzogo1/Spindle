import { getNodeType } from "./registry"
import {
  portTypesCompatible,
  type AutomationGraph,
  type ConfigField,
  type ConnectionResult,
  type GraphConnection,
  type GraphEdge,
  type GraphIssue,
  type GraphNode,
  type NodeTypeDef,
} from "./types"

export const GRAPH_DSL_VERSION = 1

export function createNodeId(): string {
  return `n_${Math.random().toString(36).slice(2, 10)}`
}

export function createEdgeId(): string {
  return `e_${Math.random().toString(36).slice(2, 10)}`
}

export function createGraphId(): string {
  return `g_${Math.random().toString(36).slice(2, 10)}`
}

export function createEmptyGraph(name = "Untitled automation"): AutomationGraph {
  return { id: createGraphId(), name, nodes: [], edges: [] }
}

export function getNode(graph: AutomationGraph, nodeId: string): GraphNode | undefined {
  return graph.nodes.find((node) => node.id === nodeId)
}

export function getNodeTypeDef(node: GraphNode): NodeTypeDef | undefined {
  return getNodeType(node.type)
}

export function getOutputPort(node: GraphNode, portId: string) {
  return getNodeTypeDef(node)?.outputs.find((port) => port.id === portId)
}

export function getInputPort(node: GraphNode, portId: string) {
  return getNodeTypeDef(node)?.inputs.find((port) => port.id === portId)
}

export function outgoingEdges(graph: AutomationGraph, nodeId: string): GraphEdge[] {
  return graph.edges.filter((edge) => edge.sourceNodeId === nodeId)
}

export function incomingEdges(graph: AutomationGraph, nodeId: string): GraphEdge[] {
  return graph.edges.filter((edge) => edge.targetNodeId === nodeId)
}

/**
 * Validate a single prospective connection against the graph. Returns a
 * human-readable reason when the connection is not allowed.
 */
export function canConnect(graph: AutomationGraph, conn: GraphConnection): ConnectionResult {
  const source = getNode(graph, conn.sourceNodeId)
  if (!source) return { ok: false, reason: "Source node does not exist." }
  const target = getNode(graph, conn.targetNodeId)
  if (!target) return { ok: false, reason: "Target node does not exist." }

  if (conn.sourceNodeId === conn.targetNodeId) {
    return { ok: false, reason: "Nodes cannot connect to themselves." }
  }

  const sourceDef = getNodeTypeDef(source)
  const targetDef = getNodeTypeDef(target)
  if (!sourceDef) return { ok: false, reason: `Unknown node type "${source.type}".` }
  if (!targetDef) return { ok: false, reason: `Unknown node type "${target.type}".` }

  const outPort = sourceDef.outputs.find((port) => port.id === conn.sourcePort)
  if (!outPort)
    return { ok: false, reason: `Node "${source.label}" has no output "${conn.sourcePort}".` }
  const inPort = targetDef.inputs.find((port) => port.id === conn.targetPort)
  if (!inPort)
    return { ok: false, reason: `Node "${target.label}" has no input "${conn.targetPort}".` }

  const duplicate = graph.edges.some(
    (edge) =>
      edge.sourceNodeId === conn.sourceNodeId &&
      edge.sourcePort === conn.sourcePort &&
      edge.targetNodeId === conn.targetNodeId &&
      edge.targetPort === conn.targetPort,
  )
  if (duplicate) return { ok: false, reason: "This connection already exists." }

  if (!portTypesCompatible(outPort.type, inPort.type)) {
    return {
      ok: false,
      reason: `Type mismatch: "${outPort.type}" cannot feed "${inPort.type}".`,
    }
  }

  // Reject connections that would close a cycle: target must not already be
  // able to reach the source through existing edges.
  if (createsCycle(graph, conn)) {
    return { ok: false, reason: "This connection would create a cycle." }
  }

  return { ok: true }
}

/**
 * Would adding `conn` (source → target) create a cycle? Equivalent to asking
 * whether the target node can already reach the source node.
 */
export function createsCycle(graph: AutomationGraph, conn: GraphConnection): boolean {
  const adjacency = new Map<string, string[]>()
  for (const node of graph.nodes) adjacency.set(node.id, [])
  for (const edge of graph.edges) {
    adjacency.get(edge.sourceNodeId)?.push(edge.targetNodeId)
  }

  // DFS from the target; reaching the source means the new edge closes a loop.
  const visited = new Set<string>()
  const stack = [conn.targetNodeId]
  while (stack.length > 0) {
    const current = stack.pop()!
    if (current === conn.sourceNodeId) return true
    if (visited.has(current)) continue
    visited.add(current)
    for (const next of adjacency.get(current) ?? []) stack.push(next)
  }
  return false
}

/**
 * Kahn's algorithm. Returns the topological order plus the ids of nodes that
 * could not be ordered because they participate in (or depend on) a cycle.
 */
export function topologicalSort(graph: AutomationGraph): {
  order: string[]
  cyclic: string[]
} {
  const indegree = new Map<string, number>()
  const adjacency = new Map<string, string[]>()
  for (const node of graph.nodes) {
    indegree.set(node.id, 0)
    adjacency.set(node.id, [])
  }
  for (const edge of graph.edges) {
    if (!indegree.has(edge.sourceNodeId) || !indegree.has(edge.targetNodeId)) continue
    adjacency.get(edge.sourceNodeId)?.push(edge.targetNodeId)
    indegree.set(edge.targetNodeId, (indegree.get(edge.targetNodeId) ?? 0) + 1)
  }

  const queue = graph.nodes.filter((node) => (indegree.get(node.id) ?? 0) === 0).map((n) => n.id)
  const order: string[] = []
  while (queue.length > 0) {
    const id = queue.shift()!
    order.push(id)
    for (const next of adjacency.get(id) ?? []) {
      const remaining = (indegree.get(next) ?? 0) - 1
      indegree.set(next, remaining)
      if (remaining === 0) queue.push(next)
    }
  }

  const ordered = new Set(order)
  const cyclic = graph.nodes.filter((node) => !ordered.has(node.id)).map((node) => node.id)
  return { order, cyclic }
}

/** Collect every issue in the graph: bad edges, cycles, structural warnings. */
export function validateGraph(graph: AutomationGraph): GraphIssue[] {
  const issues: GraphIssue[] = []
  const edgeKeys = new Set<string>()

  for (const edge of graph.edges) {
    const source = getNode(graph, edge.sourceNodeId)
    const target = getNode(graph, edge.targetNodeId)

    if (!source || !target) {
      issues.push({
        severity: "error",
        code: "unknown-node",
        message: "An edge references a node that no longer exists.",
        edgeId: edge.id,
      })
      continue
    }

    const sourceDef = getNodeTypeDef(source)
    const targetDef = getNodeTypeDef(target)
    if (!sourceDef || !targetDef) {
      issues.push({
        severity: "error",
        code: "unknown-node-type",
        message: `Node "${source.label}" or "${target.label}" has an unknown type.`,
        edgeId: edge.id,
      })
      continue
    }

    const outPort = sourceDef.outputs.find((port) => port.id === edge.sourcePort)
    const inPort = targetDef.inputs.find((port) => port.id === edge.targetPort)
    if (!outPort || !inPort) {
      issues.push({
        severity: "error",
        code: "unknown-port",
        message: `Edge "${edge.id}" references a port that does not exist.`,
        edgeId: edge.id,
      })
      continue
    }

    if (edge.sourceNodeId === edge.targetNodeId) {
      issues.push({
        severity: "error",
        code: "self-loop",
        message: `"${source.label}" cannot connect to itself.`,
        edgeId: edge.id,
        nodeId: source.id,
      })
    }

    const key = `${edge.sourceNodeId}:${edge.sourcePort}->${edge.targetNodeId}:${edge.targetPort}`
    if (edgeKeys.has(key)) {
      issues.push({
        severity: "error",
        code: "duplicate-edge",
        message: `Duplicate connection into "${target.label}".`,
        edgeId: edge.id,
      })
    }
    edgeKeys.add(key)

    if (!portTypesCompatible(outPort.type, inPort.type)) {
      issues.push({
        severity: "error",
        code: "type-mismatch",
        message: `Type mismatch on edge into "${target.label}": "${outPort.type}" cannot feed "${inPort.type}".`,
        edgeId: edge.id,
      })
    }
  }

  // Orphan nodes with unknown registry types, plus required config fields
  // that were never filled in (the dry-run engine and codegen treat these as
  // hard failures, so they surface as errors here).
  for (const node of graph.nodes) {
    const def = getNodeTypeDef(node)
    if (!def) {
      issues.push({
        severity: "error",
        code: "unknown-node-type",
        message: `Node "${node.label}" has unknown type "${node.type}".`,
        nodeId: node.id,
      })
      continue
    }
    for (const field of def.configFields) {
      if (!field.required) continue
      const value = node.config[field.key]
      const missing =
        value === undefined || value === null || (typeof value === "string" && value.trim() === "")
      if (missing) {
        issues.push({
          severity: "error",
          code: "missing-config",
          message: `"${node.label}" is missing required configuration "${field.label}".`,
          nodeId: node.id,
        })
      }
    }
  }

  const { cyclic } = topologicalSort(graph)
  if (cyclic.length > 0) {
    const names = cyclic
      .map((id) => getNode(graph, id)?.label ?? id)
      .slice(0, 4)
      .join(", ")
    issues.push({
      severity: "error",
      code: "cycle",
      message: `Cyclic dependency detected involving: ${names}${cyclic.length > 4 ? "…" : ""}.`,
      nodeId: cyclic[0],
    })
  }

  const hasTrigger = graph.nodes.some((node) => getNodeTypeDef(node)?.category === "trigger")
  if (graph.nodes.length > 0 && !hasTrigger) {
    issues.push({
      severity: "warning",
      code: "missing-trigger",
      message: "This graph has no trigger node, so it can never start on its own.",
    })
  }

  if (cyclic.length === 0) {
    // Warn about nodes that can never receive data because nothing reaches them.
    const { order } = topologicalSort(graph)
    const reachable = new Set<string>()
    const queue = graph.nodes
      .filter((node) => getNodeTypeDef(node)?.category === "trigger")
      .map((node) => node.id)
    for (const id of queue) reachable.add(id)
    const byId = new Map(graph.nodes.map((node) => [node.id, node]))
    // BFS over edges from triggers.
    const adj = new Map<string, string[]>()
    for (const edge of graph.edges) {
      if (!byId.has(edge.sourceNodeId) || !byId.has(edge.targetNodeId)) continue
      adj.set(edge.sourceNodeId, [...(adj.get(edge.sourceNodeId) ?? []), edge.targetNodeId])
    }
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
    void order
    for (const node of graph.nodes) {
      const def = getNodeTypeDef(node)
      if (def && def.category !== "trigger" && !reachable.has(node.id)) {
        issues.push({
          severity: "warning",
          code: "unreachable-node",
          message: `"${node.label}" is not reachable from any trigger.`,
          nodeId: node.id,
        })
      }
    }
  }

  return issues
}

/** True when the graph has no error-severity issues. */
export function isGraphValid(graph: AutomationGraph): boolean {
  return !validateGraph(graph).some((issue) => issue.severity === "error")
}

/* ------------------------------------------------------------------------ */
/* Serialization (JSON DSL)                                                 */
/* ------------------------------------------------------------------------ */

export interface GraphDsl {
  version: number
  graph: AutomationGraph
}

export function serializeGraph(graph: AutomationGraph): string {
  const dsl: GraphDsl = { version: GRAPH_DSL_VERSION, graph }
  return JSON.stringify(dsl, null, 2)
}

/**
 * Validate an already-parsed DSL value (JSON or YAML) and return the wrapped
 * graph. Accepts both the `{ version, graph }` DSL envelope and a bare
 * AutomationGraph for convenience.
 */
export function graphFromUnknown(value: unknown): AutomationGraph {
  const parsed = value as GraphDsl | AutomationGraph
  const graph =
    parsed && typeof parsed === "object" && "graph" in parsed
      ? (parsed as GraphDsl).graph
      : (parsed as AutomationGraph)

  if (
    !graph ||
    typeof graph !== "object" ||
    !Array.isArray(graph.nodes) ||
    !Array.isArray(graph.edges) ||
    typeof graph.id !== "string"
  ) {
    throw new Error("Invalid automation graph: expected nodes and edges arrays.")
  }
  return graph
}

export function deserializeGraph(source: string): AutomationGraph {
  return graphFromUnknown(JSON.parse(source))
}

/* ------------------------------------------------------------------------ */
/* Declarative spec + code generation                                        */
/* ------------------------------------------------------------------------ */

/**
 * A normalized, versioned spec derived from the graph. This is the artifact a
 * future runner would consume; keeping it separate from canvas state (node
 * positions, labels) makes it stable across editor changes.
 */
export interface AutomationSpec {
  version: number
  name: string
  nodes: {
    id: string
    type: string
    label?: string
    config: Record<string, unknown>
    inputs: { port: string; from: { node: string; port: string }[] }[]
  }[]
  edges: { id: string; source: string; sourcePort: string; target: string; targetPort: string }[]
}

export function graphToSpec(graph: AutomationGraph): AutomationSpec {
  return {
    version: GRAPH_DSL_VERSION,
    name: graph.name,
    nodes: graph.nodes.map((node) => {
      const def = getNodeTypeDef(node)
      const inputs = (def?.inputs ?? []).map((port) => ({
        port: port.id,
        from: graph.edges
          .filter((edge) => edge.targetNodeId === node.id && edge.targetPort === port.id)
          .map((edge) => ({ node: edge.sourceNodeId, port: edge.sourcePort })),
      }))
      return { id: node.id, type: node.type, label: node.label, config: node.config, inputs }
    }),
    edges: graph.edges.map((edge) => ({
      id: edge.id,
      source: edge.sourceNodeId,
      sourcePort: edge.sourcePort,
      target: edge.targetNodeId,
      targetPort: edge.targetPort,
    })),
  }
}

export function specToGraph(spec: AutomationSpec): AutomationGraph {
  return {
    id: `g_spec_${spec.name.toLowerCase().replace(/[^a-z0-9]+/g, "_") || "automation"}`,
    name: spec.name,
    nodes: spec.nodes.map((node, index) => ({
      id: node.id,
      type: node.type,
      label: node.label || node.id,
      config: node.config,
      position: { x: 80 + (index % 3) * 280, y: 80 + Math.floor(index / 3) * 180 },
    })),
    edges: spec.edges.map((edge) => ({
      id: edge.id,
      sourceNodeId: edge.source,
      sourcePort: edge.sourcePort,
      targetNodeId: edge.target,
      targetPort: edge.targetPort,
    })),
  }
}

/**
 * Generate a TypeScript module string that exports the automation spec as a
 * plain data literal. The generated code is deterministic for a given graph.
 */
export function generateCode(graph: AutomationGraph): string {
  const spec = graphToSpec(graph)
  const specJson = JSON.stringify(spec, null, 2)
  return [
    "/**",
    " * Generated by the Spindle automation builder.",
    " * Do not edit by hand — regenerate from the visual builder.",
    " */",
    "",
    "export interface AutomationSpec {",
    "  version: number",
    "  name: string",
    "  nodes: unknown[]",
    "  edges: unknown[]",
    "}",
    "",
    `export const automationSpec: AutomationSpec = ${specJson}`,
    "",
  ].join("\n")
}

/**
 * Extract the embedded spec from code produced by `generateCode`. Used by
 * tests and by tooling that needs to round-trip generated output.
 */
export function extractSpecFromCode(code: string): AutomationSpec {
  const marker = "export const automationSpec"
  const start = code.indexOf(marker)
  if (start === -1) throw new Error("No automationSpec export found in generated code.")
  const eq = code.indexOf("=", start)
  if (eq === -1) throw new Error("Malformed generated code: missing assignment.")
  const jsonStart = code.indexOf("{", eq)
  if (jsonStart === -1) throw new Error("Malformed generated code: missing spec object.")
  // The spec literal is the remainder of the file (JSON has no trailing code).
  return JSON.parse(code.slice(jsonStart).trim()) as AutomationSpec
}

/* ------------------------------------------------------------------------ */
/* Graph mutation helpers (used by the builder UI)                          */
/* ------------------------------------------------------------------------ */

export function addNodeToGraph(
  graph: AutomationGraph,
  type: string,
  position: { x: number; y: number },
): AutomationGraph {
  const def = getNodeType(type)
  const node: GraphNode = {
    id: createNodeId(),
    type,
    label: def?.label ?? type,
    config: { ...(def?.defaultConfig ?? {}) },
    position,
  }
  return { ...graph, nodes: [...graph.nodes, node] }
}

export function removeNodeFromGraph(graph: AutomationGraph, nodeId: string): AutomationGraph {
  return {
    ...graph,
    nodes: graph.nodes.filter((node) => node.id !== nodeId),
    edges: graph.edges.filter(
      (edge) => edge.sourceNodeId !== nodeId && edge.targetNodeId !== nodeId,
    ),
  }
}

export function addEdgeToGraph(graph: AutomationGraph, conn: GraphConnection): AutomationGraph {
  const check = canConnect(graph, conn)
  if (!check.ok) throw new Error(check.reason)
  const edge: GraphEdge = { id: createEdgeId(), ...conn }
  return { ...graph, edges: [...graph.edges, edge] }
}

export function removeEdgeFromGraph(graph: AutomationGraph, edgeId: string): AutomationGraph {
  return { ...graph, edges: graph.edges.filter((edge) => edge.id !== edgeId) }
}

export function updateNode(
  graph: AutomationGraph,
  nodeId: string,
  patch: Partial<GraphNode>,
): AutomationGraph {
  return {
    ...graph,
    nodes: graph.nodes.map((node) => (node.id === nodeId ? { ...node, ...patch } : node)),
  }
}

export function configFieldsForType(type: string): ConfigField[] {
  return getNodeType(type)?.configFields ?? []
}
