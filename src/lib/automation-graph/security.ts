import { isTriggerType } from "./registry"
import type { AutomationGraph, GraphNode } from "./types"

/**
 * Static security scan for automation graphs. Rule-based heuristics over node
 * config values and graph shape — flags secrets, injection-looking strings,
 * external URLs, unvalidated event inputs, and ungated actions.
 */

export type SecuritySeverity = "info" | "warning" | "critical"

export type SecurityRule =
  | "secret-in-config"
  | "injection-pattern"
  | "external-url"
  | "unvalidated-input"
  | "ungated-action"
  | "missing-logging"

export interface SecurityFinding {
  id: string
  rule: SecurityRule
  severity: SecuritySeverity
  title: string
  detail: string
  nodeId?: string
  nodeLabel?: string
}

const SECRET_PATTERN =
  /(api[_-]?key|secret|token|password|passwd|credential|bearer|private[_-]?key)/i
const SECRET_VALUE_PATTERN =
  /(sk-[a-zA-Z0-9]{16,}|ghp_[a-zA-Z0-9]{20,}|xox[baprs]-[a-zA-Z0-9-]{10,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/
const INJECTION_PATTERN = /(`|\$\(|\$\{|;\s*(rm|curl|wget|nc|chmod|chown)\b|\|\s*(sh|bash)\b)/
const URL_PATTERN = /https?:\/\/[^\s"']+/i

function configStrings(node: GraphNode): { key: string; value: string }[] {
  const out: { key: string; value: string }[] = []
  for (const [key, value] of Object.entries(node.config)) {
    if (typeof value === "string" && value.trim()) out.push({ key, value })
  }
  return out
}

function finding(
  rule: SecurityRule,
  severity: SecuritySeverity,
  title: string,
  detail: string,
  node?: GraphNode,
  /** Disambiguates multiple findings of the same rule on one node (e.g. config key). */
  discriminator?: string,
): SecurityFinding {
  return {
    id: `${rule}-${node?.id ?? "graph"}${discriminator ? `-${discriminator}` : ""}`,
    rule,
    severity,
    title,
    detail,
    nodeId: node?.id,
    nodeLabel: node?.label,
  }
}

/** Scan the graph for risky patterns. Deterministic; sorted critical-first. */
export function scanGraphSecurity(graph: AutomationGraph): SecurityFinding[] {
  const findings: SecurityFinding[] = []
  const byId = new Map(graph.nodes.map((n) => [n.id, n]))

  for (const node of graph.nodes) {
    for (const { key, value } of configStrings(node)) {
      if (SECRET_VALUE_PATTERN.test(value) || (SECRET_PATTERN.test(key) && value.length >= 8)) {
        findings.push(
          finding(
            "secret-in-config",
            "critical",
            "Possible secret in node config",
            `"${node.label}" stores a credential-looking value in "${key}". Move it to a secrets manager or environment variable.`,
            node,
            key,
          ),
        )
      }
      if (INJECTION_PATTERN.test(value)) {
        findings.push(
          finding(
            "injection-pattern",
            "warning",
            "Possible injection pattern in config",
            `"${node.label}" field "${key}" contains shell/template metacharacters.`,
            node,
            key,
          ),
        )
      }
      if (URL_PATTERN.test(value)) {
        findings.push(
          finding(
            "external-url",
            "warning",
            "External URL in node config",
            `"${node.label}" field "${key}" references an external URL — review for SSRF/data-exfiltration risk.`,
            node,
            key,
          ),
        )
      }
    }
  }

  // Event triggers feed untrusted external data; they should pass through a
  // condition/transform (validation) before reaching actions.
  const hasCondition = graph.nodes.some((n) => n.type === "condition")
  const hasTransform = graph.nodes.some((n) => n.type === "transform")

  /** Node ids reachable from `startId` via outgoing edges (BFS). */
  function reachableFrom(startId: string): Set<string> {
    const seen = new Set<string>([startId])
    const queue = [startId]
    while (queue.length) {
      const current = queue.shift()!
      for (const edge of graph.edges) {
        if (edge.sourceNodeId !== current) continue
        if (!seen.has(edge.targetNodeId)) {
          seen.add(edge.targetNodeId)
          queue.push(edge.targetNodeId)
        }
      }
    }
    return seen
  }

  const isActionType = (type: string) => type.startsWith("action.") || type === "agent.task"

  const eventTriggers = graph.nodes.filter((n) => n.type === "trigger.event")
  for (const trigger of eventTriggers) {
    // Only flag when an action/agent node is actually reachable downstream —
    // a trigger wired only to dead-end transforms isn't an exfil path.
    const downstream = reachableFrom(trigger.id)
    const reachesAction = graph.nodes.some(
      (n) => n.id !== trigger.id && isActionType(n.type) && downstream.has(n.id),
    )
    if (reachesAction && !hasCondition && !hasTransform) {
      findings.push(
        finding(
          "unvalidated-input",
          "warning",
          "Unvalidated event input",
          `"${trigger.label}" feeds actions without a condition or transform step to validate the payload.`,
          trigger,
        ),
      )
    }
  }

  // Actions reachable directly from a trigger with no gating logic at all.
  const directActionEdges = graph.edges.filter((edge) => {
    const source = byId.get(edge.sourceNodeId)
    const target = byId.get(edge.targetNodeId)
    return source && isTriggerType(source.type) && target?.type.startsWith("action.")
  })
  if (directActionEdges.length > 0 && !hasCondition) {
    findings.push(
      finding(
        "ungated-action",
        "warning",
        "Actions run without a gate",
        "At least one action is wired straight to a trigger with no condition or approval step in between.",
      ),
    )
  }

  // Long-running automations should leave an audit trail.
  const hasLogging = graph.nodes.some((n) => n.type === "action.log" || n.type === "agent.task")
  const actionCount = graph.nodes.filter((n) => n.type.startsWith("action.")).length
  if (actionCount > 0 && !hasLogging) {
    findings.push(
      finding(
        "missing-logging",
        "info",
        "No logging or agent step",
        "This graph performs actions but has no log entry or agent step for auditability.",
      ),
    )
  }

  const rank = { critical: 0, warning: 1, info: 2 } as const
  return findings.sort(
    (a, b) => rank[a.severity] - rank[b.severity] || a.rule.localeCompare(b.rule),
  )
}

export function securitySummary(findings: SecurityFinding[]): {
  critical: number
  warning: number
  info: number
  clean: boolean
} {
  return {
    critical: findings.filter((f) => f.severity === "critical").length,
    warning: findings.filter((f) => f.severity === "warning").length,
    info: findings.filter((f) => f.severity === "info").length,
    clean: findings.length === 0,
  }
}
