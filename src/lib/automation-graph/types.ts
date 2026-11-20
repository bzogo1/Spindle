/**
 * Core types for the automation graph model.
 *
 * An automation graph is a directed graph of nodes connected through typed
 * ports. Nodes come from a fixed registry (see `registry.ts`) so the canvas,
 * the inspector, the validator, and the dry-run engine all agree on what a
 * node can look like.
 */

export type PortType = "any" | "string" | "number" | "boolean" | "json"

export interface PortDef {
  /** Stable port id, unique within the node (e.g. "in", "out", "true"). */
  id: string
  type: PortType
  label?: string
}

export type ConfigFieldKind = "text" | "textarea" | "number" | "boolean" | "select"

export interface ConfigFieldOption {
  value: string
  label: string
}

export interface ConfigField {
  key: string
  label: string
  kind: ConfigFieldKind
  placeholder?: string
  options?: ConfigFieldOption[]
  required?: boolean
  hint?: string
}

export type NodeCategory = "trigger" | "action" | "logic" | "transform"

export interface NodeTypeDef {
  /** Registry key stored on `GraphNode.type`. */
  type: string
  label: string
  category: NodeCategory
  description: string
  inputs: PortDef[]
  outputs: PortDef[]
  configFields: ConfigField[]
  defaultConfig: Record<string, unknown>
}

export interface NodePosition {
  x: number
  y: number
}

export interface GraphNode {
  id: string
  /** Key into `NODE_TYPES`. */
  type: string
  label: string
  config: Record<string, unknown>
  position: NodePosition
}

export interface GraphEdge {
  id: string
  sourceNodeId: string
  sourcePort: string
  targetNodeId: string
  targetPort: string
}

/** The fields needed to describe a prospective or existing connection. */
export interface GraphConnection {
  sourceNodeId: string
  sourcePort: string
  targetNodeId: string
  targetPort: string
}

export interface AutomationGraph {
  id: string
  name: string
  nodes: GraphNode[]
  edges: GraphEdge[]
}

export type IssueSeverity = "error" | "warning"

export type IssueCode =
  | "unknown-node"
  | "unknown-port"
  | "port-direction"
  | "self-loop"
  | "duplicate-edge"
  | "type-mismatch"
  | "cycle"
  | "missing-trigger"
  | "unreachable-node"
  | "unknown-node-type"
  | "missing-config"

export interface GraphIssue {
  severity: IssueSeverity
  code: IssueCode
  message: string
  nodeId?: string
  edgeId?: string
}

export type ConnectionResult = { ok: true } | { ok: false; reason: string }

/**
 * Port type compatibility. `any` is the wildcard on both sides; `json` accepts
 * every concrete type because any value is representable as JSON.
 */
export function portTypesCompatible(source: PortType, target: PortType): boolean {
  if (source === target) return true
  if (source === "any" || target === "any") return true
  if (target === "json") return true
  return false
}
