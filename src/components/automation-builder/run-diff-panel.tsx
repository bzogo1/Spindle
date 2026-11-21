"use client"

import { useMemo } from "react"
import { GitCompareArrows } from "lucide-react"

import {
  describeDiff,
  diffGraphs,
  nodeLabel,
  useAutomationRunMetrics,
  useGraphVersions,
  type AutomationGraph,
  type GraphVersion,
} from "@/lib/automation-graph"
import { formatDateTime, formatRelativeTime } from "@/components/app/format"

interface RunDiffPanelProps {
  /** localStorage scope shared with the run log and version history. */
  scope: string
}

/**
 * Graph snapshot in effect when a run happened: the newest version recorded
 * at or before the run's `ranAt` timestamp. Versions are stored newest-first.
 */
function graphForRun(versions: readonly GraphVersion[], ranAt: string): AutomationGraph | null {
  const runTime = new Date(ranAt).getTime()
  if (Number.isNaN(runTime)) return null
  for (const version of versions) {
    const versionTime = new Date(version.createdAt).getTime()
    if (!Number.isNaN(versionTime) && versionTime <= runTime) return version.graph
  }
  return null
}

/**
 * "What changed between the last two runs" for graph-backed automations:
 * resolves each of the two most recent run-log entries to the graph version
 * that was current when it ran, then renders the structural diff via
 * `diffGraphs` from `src/lib/automation-graph/diff.ts`.
 */
export function RunDiffPanel({ scope }: RunDiffPanelProps) {
  const metrics = useAutomationRunMetrics(scope, 2)
  const versions = useGraphVersions(scope)

  const comparison = useMemo(() => {
    const [current, previous] = metrics.recent
    if (!current || !previous) return null
    const before = graphForRun(versions, previous.ranAt)
    const after = graphForRun(versions, current.ranAt)
    if (!before || !after) return null
    return { before, after, previous, current, diff: diffGraphs(before, after) }
  }, [metrics.recent, versions])

  return (
    <section
      className="border-border bg-card flex flex-col gap-2 rounded-lg border p-3"
      aria-labelledby="builder-run-diff-heading"
    >
      <h3
        id="builder-run-diff-heading"
        className="text-muted-foreground flex items-center gap-1.5 text-xs font-semibold tracking-wide uppercase"
      >
        <GitCompareArrows className="size-3.5" aria-hidden="true" />
        Run diff
      </h3>

      {metrics.totalRuns < 2 ? (
        <p className="text-muted-foreground text-[11px]">
          Run the automation at least twice to compare what changed between runs.
        </p>
      ) : !comparison ? (
        <p className="text-muted-foreground text-[11px]">
          Graph snapshots are recorded while editing — make a change and run a dry run twice to
          populate the diff.
        </p>
      ) : (
        <div className="flex flex-col gap-1.5">
          <p className="text-muted-foreground text-[10px]">
            {formatRelativeTime(comparison.previous.ranAt)} →{" "}
            {formatRelativeTime(comparison.current.ranAt)} (
            {formatDateTime(comparison.previous.ranAt)} → {formatDateTime(comparison.current.ranAt)})
          </p>
          <p className="text-[11px] font-medium">{describeDiff(comparison.diff)}</p>
          {comparison.diff.unchanged ? (
            <p className="text-muted-foreground text-[11px]">
              The graph was identical for both runs.
            </p>
          ) : (
            <div className="text-muted-foreground flex flex-col gap-1 text-[10px]">
              {comparison.diff.changedNodes.length > 0 ? (
                <ul className="flex flex-col gap-0.5">
                  {comparison.diff.changedNodes.slice(0, 6).map((change) => (
                    <li key={change.nodeId}>
                      ~ {change.label}: {change.changes.map((c) => c.field).join(", ")}
                    </li>
                  ))}
                  {comparison.diff.changedNodes.length > 6 ? (
                    <li>…and {comparison.diff.changedNodes.length - 6} more</li>
                  ) : null}
                </ul>
              ) : null}
              {comparison.diff.addedNodes.length > 0 ? (
                <p>+ {comparison.diff.addedNodes.map((n) => n.label).join(", ")}</p>
              ) : null}
              {comparison.diff.removedNodes.length > 0 ? (
                <p>
                  −{" "}
                  {comparison.diff.removedNodes
                    .map((n) => nodeLabel(comparison.before, n.id))
                    .join(", ")}
                </p>
              ) : null}
              {comparison.diff.addedEdges.length > 0 ? (
                <p>+ {comparison.diff.addedEdges.length} connection(s)</p>
              ) : null}
              {comparison.diff.removedEdges.length > 0 ? (
                <p>− {comparison.diff.removedEdges.length} connection(s)</p>
              ) : null}
            </div>
          )}
        </div>
      )}
    </section>
  )
}
