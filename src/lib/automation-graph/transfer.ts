import { parse as parseYaml, stringify as stringifyYaml } from "yaml"

import {
  GRAPH_DSL_VERSION,
  graphFromUnknown,
  serializeGraph,
  validateGraph,
  type GraphDsl,
} from "./graph"
import type { AutomationGraph, GraphIssue } from "./types"

/**
 * Import/export helpers for automation graphs.
 *
 * The on-disk format is the same DSL envelope `serializeGraph` produces —
 * `{ version, graph }` — serialized as either pretty-printed JSON or YAML.
 * Imports accept both formats plus a bare `AutomationGraph` (no envelope),
 * matching `deserializeGraph`'s tolerance.
 */

export type GraphTransferFormat = "json" | "yaml"

/** Same ceiling the settings import/export card uses. */
export const GRAPH_TRANSFER_MAX_BYTES = 256 * 1024

export function serializeGraphJson(graph: AutomationGraph): string {
  return serializeGraph(graph)
}

export function serializeGraphYaml(graph: AutomationGraph): string {
  const dsl: GraphDsl = { version: GRAPH_DSL_VERSION, graph }
  return stringifyYaml(dsl)
}

export type GraphImportResult =
  { ok: true; graph: AutomationGraph; issues: GraphIssue[] } | { ok: false; error: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isValidNodeShape(node: unknown): boolean {
  if (!isRecord(node)) return false
  return (
    typeof node.id === "string" &&
    typeof node.type === "string" &&
    typeof node.label === "string" &&
    isRecord(node.config) &&
    isRecord(node.position) &&
    typeof node.position.x === "number" &&
    typeof node.position.y === "number"
  )
}

function isValidEdgeShape(edge: unknown): boolean {
  if (!isRecord(edge)) return false
  return (
    typeof edge.id === "string" &&
    typeof edge.sourceNodeId === "string" &&
    typeof edge.sourcePort === "string" &&
    typeof edge.targetNodeId === "string" &&
    typeof edge.targetPort === "string"
  )
}

/**
 * Deeper structural check than `graphFromUnknown`: `validateGraph` assumes
 * well-formed node/edge entries, so imports must reject anything that would
 * crash it (null entries, missing ports, non-numeric positions, …).
 */
function assertGraphShape(graph: AutomationGraph): void {
  if (typeof graph.name !== "string" || graph.name.trim() === "") {
    graph.name = "Imported automation"
  }
  if (!graph.nodes.every(isValidNodeShape) || !graph.edges.every(isValidEdgeShape)) {
    throw new Error("malformed entries")
  }
  const nodeIds = new Set<string>()
  for (const node of graph.nodes) {
    if (nodeIds.has(node.id)) throw new Error("duplicate node ids")
    nodeIds.add(node.id)
  }
}

/**
 * Parse an imported graph file and run `validateGraph` on it. Succeeds when
 * the payload is structurally sound and has no error-severity issues;
 * warning-severity issues (e.g. unreachable nodes) are returned alongside
 * the graph so the UI can mention them.
 */
export function parseGraphImport(source: string, format: GraphTransferFormat): GraphImportResult {
  let value: unknown
  try {
    value = format === "yaml" ? parseYaml(source) : JSON.parse(source)
  } catch {
    return {
      ok: false,
      error: format === "yaml" ? "The file is not valid YAML." : "The file is not valid JSON.",
    }
  }

  let graph: AutomationGraph
  try {
    graph = graphFromUnknown(value)
    assertGraphShape(graph)
  } catch {
    return {
      ok: false,
      error: "The file does not contain a valid automation graph.",
    }
  }

  const issues = validateGraph(graph)
  const firstError = issues.find((issue) => issue.severity === "error")
  if (firstError) {
    return {
      ok: false,
      error: `The imported graph has errors: ${firstError.message}`,
    }
  }
  return { ok: true, graph, issues }
}

/** Guess the transfer format from a file name; defaults to JSON. */
export function graphTransferFormatForFileName(fileName: string): GraphTransferFormat {
  return /\.ya?ml$/i.test(fileName.trim()) ? "yaml" : "json"
}
