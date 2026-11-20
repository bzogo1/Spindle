import { getNodeType } from "./registry"
import type { AutomationGraph } from "./types"
import type { DryRunReport, NodeRunResult } from "./dry-run"

/**
 * Per-node profiling derived from a dry-run report. Durations come from the
 * deterministic simulator; a static per-type "cost" weight is added so the
 * flame view reflects relative expense even when simulated timings are flat.
 */

export interface NodeProfile {
  nodeId: string
  label: string
  type: string
  status: NodeRunResult["status"]
  startedAtMs: number
  durationMs: number
  /** 0–1 share of total run time. */
  share: number
  /** Static cost weight for the node type (higher = more expensive). */
  costUnits: number
}

export interface ProfileReport {
  totalMs: number
  /** Nodes in execution order (as reported by the dry run). */
  nodes: NodeProfile[]
  /** Node with the largest durationMs, when any node ran. */
  bottleneckNodeId: string | null
  /** Nodes taking ≥25% of total time (and >1 node ran). */
  hotspots: NodeProfile[]
}

/** Rough relative cost per node type, used to weight the flame view. */
export const NODE_COST_UNITS: Record<string, number> = {
  "trigger.schedule": 1,
  "trigger.event": 1,
  "trigger.webhook": 1,
  transform: 2,
  condition: 2,
  "action.log": 3,
  "action.post-summary": 4,
  "action.update-files": 5,
  "action.webhook": 4,
  "agent.task": 10,
}

export function nodeCostUnits(type: string): number {
  return NODE_COST_UNITS[type] ?? 3
}

export function profileDryRun(graph: AutomationGraph, report: DryRunReport): ProfileReport {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]))
  let totalMs = 0
  for (const result of report.results) {
    totalMs = Math.max(totalMs, result.startedAtMs + result.durationMs)
  }
  if (totalMs === 0) {
    totalMs = report.results.reduce((sum, r) => sum + r.durationMs, 0)
  }

  const nodes: NodeProfile[] = report.results.map((result) => {
    const node = byId.get(result.nodeId)
    return {
      nodeId: result.nodeId,
      label: node?.label ?? getNodeType(node?.type ?? "")?.label ?? result.nodeId,
      type: node?.type ?? "",
      status: result.status,
      startedAtMs: result.startedAtMs,
      durationMs: result.durationMs,
      share: totalMs > 0 ? result.durationMs / totalMs : 0,
      costUnits: nodeCostUnits(node?.type ?? ""),
    }
  })

  const executed = nodes.filter((n) => n.status === "success" || n.status === "error")
  const bottleneck = executed.reduce<NodeProfile | null>(
    (max, n) => (max === null || n.durationMs > max.durationMs ? n : max),
    null,
  )
  const hotspots =
    nodes.length > 1
      ? executed.filter((n) => n.share >= 0.25)
      : executed.filter((n) => n.share >= 0.5)

  return {
    totalMs,
    nodes,
    bottleneckNodeId: bottleneck?.nodeId ?? null,
    hotspots,
  }
}

/** Serialize a profile for export (e.g. copying to clipboard). */
export function formatProfile(profile: ProfileReport): string {
  const lines = [
    `Total: ${profile.totalMs}ms across ${profile.nodes.length} nodes`,
    ...profile.nodes.map(
      (n) =>
        `${n.nodeId.padEnd(12)} ${String(n.durationMs).padStart(5)}ms  ${(n.share * 100).toFixed(1).padStart(5)}%  ${n.status.padEnd(7)} ${n.label}`,
    ),
  ]
  return lines.join("\n")
}
