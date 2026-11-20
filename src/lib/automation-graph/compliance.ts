import { isTriggerType } from "./registry"
import type { AutomationGraph } from "./types"

/**
 * Compliance rules for automation graphs: organizational policies expressed as
 * declarative checks (required node types, allowed types, approval gates,
 * logging, retention tags). `checkCompliance` produces a report; the builder's
 * compliance panel gates "publish" on error-severity checks.
 */

export interface CompliancePolicy {
  /** Node types that must appear at least once (exact type or `prefix.*`). */
  requiredNodeTypes?: string[]
  /** Node types that must NOT appear (exact type or `prefix.*`). */
  forbiddenNodeTypes?: string[]
  /** When true, graphs containing actions must include a logic (condition) node. */
  requireApprovalGate?: boolean
  /** When true, graphs must include an `action.log` node or agent step. */
  requireLogging?: boolean
  /**
   * Config keys that must be present (non-empty) on every node of the given
   * type prefix, e.g. { nodeTypePrefix: "action.update-files", key: "retentionTag" }.
   */
  requiredConfig?: { nodeTypePrefix: string; key: string; label?: string }[]
}

export const DEFAULT_COMPLIANCE_POLICY: CompliancePolicy = {
  requireApprovalGate: true,
  requireLogging: true,
  requiredConfig: [],
}

export type ComplianceSeverity = "error" | "warning"

export interface ComplianceCheck {
  id: string
  label: string
  passed: boolean
  severity: ComplianceSeverity
  detail: string
}

export interface ComplianceReport {
  checks: ComplianceCheck[]
  /** True when no error-severity check failed. */
  publishable: boolean
  errorCount: number
  warningCount: number
}

function typeMatches(policyEntry: string, nodeType: string): boolean {
  if (policyEntry.endsWith(".*")) return nodeType.startsWith(policyEntry.slice(0, -1))
  return nodeType === policyEntry
}

function matchesAny(entries: string[] | undefined, nodeType: string): boolean {
  return (entries ?? []).some((entry) => typeMatches(entry, nodeType))
}

function hasNodeOfType(graph: AutomationGraph, matcher: (type: string) => boolean): boolean {
  return graph.nodes.some((node) => matcher(node.type))
}

/** Action-like nodes: built-in actions plus agent tasks. */
function isActionNodeType(type: string): boolean {
  return type.startsWith("action.") || type === "agent.task"
}

/** Node ids reachable from any trigger (BFS over the DAG). */
function reachableFromTriggers(graph: AutomationGraph): Set<string> {
  const reachable = new Set<string>()
  const queue = graph.nodes.filter((n) => isTriggerType(n.type)).map((n) => n.id)
  const adj = new Map<string, string[]>()
  for (const edge of graph.edges) {
    adj.set(edge.sourceNodeId, [...(adj.get(edge.sourceNodeId) ?? []), edge.targetNodeId])
  }
  const bfs = [...queue]
  for (const id of bfs) reachable.add(id)
  while (bfs.length) {
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

/**
 * Approval-gate check: returns true only when EVERY reachable action/agent
 * node sits downstream of a condition node. Conditions propagate "gated"
 * status to all their descendants; an action with no gated ancestor fails.
 */
function actionsAreGated(graph: AutomationGraph): { gated: boolean; ungatedLabels: string[] } {
  const reachable = reachableFromTriggers(graph)
  const actionNodes = graph.nodes.filter(
    (node) => isActionNodeType(node.type) && reachable.has(node.id),
  )
  if (actionNodes.length === 0) return { gated: true, ungatedLabels: [] }

  const conditionIds = new Set(graph.nodes.filter((n) => n.type === "condition").map((n) => n.id))
  // Propagate "gated" downstream from every condition node.
  const gated = new Set<string>()
  const stack = [...conditionIds]
  const adj = new Map<string, string[]>()
  for (const edge of graph.edges) {
    adj.set(edge.sourceNodeId, [...(adj.get(edge.sourceNodeId) ?? []), edge.targetNodeId])
  }
  const visited = new Set<string>(conditionIds)
  while (stack.length) {
    const current = stack.pop()!
    for (const next of adj.get(current) ?? []) {
      if (!visited.has(next)) {
        visited.add(next)
        gated.add(next)
        stack.push(next)
      }
    }
  }

  const ungatedLabels = actionNodes.filter((node) => !gated.has(node.id)).map((node) => node.label)
  return { gated: ungatedLabels.length === 0, ungatedLabels }
}

/** Evaluate a compliance policy against a graph. */
export function checkCompliance(
  graph: AutomationGraph,
  policy: CompliancePolicy = DEFAULT_COMPLIANCE_POLICY,
): ComplianceReport {
  const checks: ComplianceCheck[] = []
  const push = (
    id: string,
    label: string,
    passed: boolean,
    severity: ComplianceSeverity,
    detail: string,
  ) => checks.push({ id, label, passed, severity, detail })

  const hasTrigger = graph.nodes.some((n) => isTriggerType(n.type))
  push(
    "has-trigger",
    "Graph has a trigger",
    hasTrigger || graph.nodes.length === 0,
    "error",
    hasTrigger
      ? "At least one trigger node is present."
      : "No trigger node — the automation can never start.",
  )

  const forbidden = graph.nodes.filter((n) => matchesAny(policy.forbiddenNodeTypes, n.type))
  push(
    "forbidden-types",
    "No forbidden node types",
    forbidden.length === 0,
    "error",
    forbidden.length === 0
      ? "All node types are allowed by policy."
      : `Forbidden node types in use: ${[...new Set(forbidden.map((n) => n.type))].join(", ")}.`,
  )

  for (const required of policy.requiredNodeTypes ?? []) {
    const found = hasNodeOfType(graph, (type) => typeMatches(required, type))
    push(
      `required-${required}`,
      `Requires "${required}"`,
      found,
      "error",
      found
        ? `A node matching "${required}" is present.`
        : `Policy requires at least one node of type "${required}".`,
    )
  }

  const hasActions = graph.nodes.some((n) => isActionNodeType(n.type))
  if (policy.requireApprovalGate) {
    const gate = actionsAreGated(graph)
    push(
      "approval-gate",
      "Actions behind an approval/condition gate",
      !hasActions || gate.gated,
      "warning",
      !hasActions
        ? "No action nodes — gate check is informational only."
        : gate.gated
          ? "Every action is downstream of a condition node."
          : `Ungated actions: ${gate.ungatedLabels.join(", ")}.`,
    )
  }

  if (policy.requireLogging) {
    const hasLogging = hasNodeOfType(
      graph,
      (type) => type === "action.log" || type === "agent.task",
    )
    push(
      "logging",
      "Run logging present",
      !hasActions || hasLogging,
      "warning",
      hasLogging
        ? "A log entry or agent step provides an audit trail."
        : "Actions run without a log entry or agent step for auditability.",
    )
  }

  for (const rule of policy.requiredConfig ?? []) {
    const targets = graph.nodes.filter((n) => n.type.startsWith(rule.nodeTypePrefix))
    const missing = targets.filter((n) => {
      const value = n.config[rule.key]
      return value === undefined || value === null || String(value).trim() === ""
    })
    const label = rule.label ?? rule.key
    push(
      `config-${rule.nodeTypePrefix}-${rule.key}`,
      `"${label}" set on ${rule.nodeTypePrefix}`,
      missing.length === 0,
      "error",
      missing.length === 0
        ? targets.length === 0
          ? `No ${rule.nodeTypePrefix} nodes to check.`
          : `All ${rule.nodeTypePrefix} nodes set "${label}".`
        : `${missing.length} node(s) missing "${label}": ${missing.map((n) => n.label).join(", ")}.`,
    )
  }

  const errorCount = checks.filter((c) => !c.passed && c.severity === "error").length
  const warningCount = checks.filter((c) => !c.passed && c.severity === "warning").length
  return {
    checks,
    publishable: errorCount === 0,
    errorCount,
    warningCount,
  }
}
