"use client"

import { useMemo, useState } from "react"
import { Play, SquareTerminal } from "lucide-react"

import {
  dryRunGraph,
  getNode,
  validateGraph,
  type AutomationGraph,
  type DryRunReport,
  type NodeRunStatus,
} from "@/lib/automation-graph"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

const STATUS_BADGE: Record<NodeRunStatus, string> = {
  pending: "bg-zinc-500/15 text-zinc-500",
  running: "bg-sky-500/15 text-sky-600 dark:text-sky-400",
  success: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  error: "bg-red-500/15 text-red-600 dark:text-red-400",
  skipped: "bg-zinc-600/15 text-zinc-500",
}

interface DryRunPanelProps {
  graph: AutomationGraph
  report: DryRunReport | null
  onReport: (report: DryRunReport | null) => void
  onStatusesChange: (statuses: Record<string, NodeRunStatus>) => void
}

export function DryRunPanel({ graph, report, onReport, onStatusesChange }: DryRunPanelProps) {
  const [running, setRunning] = useState(false)

  const hasErrors = useMemo(
    () => validateGraph(graph).some((issue) => issue.severity === "error"),
    [graph],
  )

  function run() {
    setRunning(true)
    // Defer one tick so the "running" state paints before the synchronous run.
    setTimeout(() => {
      const result = dryRunGraph(graph)
      onReport(result)
      onStatusesChange(Object.fromEntries(result.results.map((r) => [r.nodeId, r.status])))
      setRunning(false)
    }, 30)
  }

  function clear() {
    onReport(null)
    onStatusesChange({})
  }

  return (
    <section
      className="border-border bg-card flex flex-col gap-2 rounded-lg border p-3"
      aria-labelledby="builder-dry-run-heading"
    >
      <div className="flex items-center justify-between gap-2">
        <h3
          id="builder-dry-run-heading"
          className="text-muted-foreground flex items-center gap-1.5 text-xs font-semibold tracking-wide uppercase"
        >
          <SquareTerminal className="size-3.5" aria-hidden="true" />
          Dry run
        </h3>
        <div className="flex gap-1.5">
          {report ? (
            <Button type="button" variant="ghost" size="sm" onClick={clear}>
              Clear
            </Button>
          ) : null}
          <Button type="button" size="sm" onClick={run} disabled={running || hasErrors}>
            <Play aria-hidden="true" />
            {running ? "Running…" : "Run dry run"}
          </Button>
        </div>
      </div>

      {hasErrors && !report ? (
        <p className="text-muted-foreground text-[11px]">
          Fix validation errors before running a dry run.
        </p>
      ) : null}

      {report ? (
        <div className="flex flex-col gap-2">
          <div className="text-muted-foreground flex items-center gap-2 text-[11px]">
            <Badge
              variant="outline"
              className={cn(
                report.status === "success" && "border-emerald-500/40 text-emerald-600",
                report.status === "error" && "border-red-500/40 text-red-600",
                report.status === "rejected" && "border-amber-500/40 text-amber-600",
              )}
            >
              {report.status}
            </Badge>
            <span>
              {report.summary.succeeded} succeeded · {report.summary.failed} failed ·{" "}
              {report.summary.skipped} skipped
            </span>
          </div>

          <ol className="flex max-h-72 flex-col gap-1.5 overflow-y-auto">
            {report.results.map((result) => {
              const node = getNode(graph, result.nodeId)
              return (
                <li
                  key={result.nodeId}
                  className="border-border/70 bg-background rounded-md border p-2"
                >
                  <div className="flex items-center gap-2">
                    <Badge
                      variant="secondary"
                      className={cn("text-[10px]", STATUS_BADGE[result.status])}
                    >
                      {result.status}
                    </Badge>
                    <span className="min-w-0 flex-1 truncate text-xs font-medium">
                      {node?.label ?? result.nodeId}
                    </span>
                    <span className="text-muted-foreground text-[10px]">{result.durationMs}ms</span>
                  </div>
                  {result.logs.length > 0 ? (
                    <pre className="bg-muted/60 text-muted-foreground mt-1.5 max-h-28 overflow-auto rounded p-1.5 font-mono text-[10px] leading-relaxed">
                      {result.logs.join("\n")}
                    </pre>
                  ) : null}
                  {result.error ? (
                    <p className="text-destructive mt-1 text-[11px]">{result.error}</p>
                  ) : null}
                  {result.output !== undefined ? (
                    <details className="mt-1">
                      <summary className="text-muted-foreground hover:text-foreground cursor-pointer text-[10px]">
                        Output
                      </summary>
                      <pre className="bg-muted/60 text-muted-foreground mt-1 max-h-28 overflow-auto rounded p-1.5 font-mono text-[10px]">
                        {JSON.stringify(result.output, null, 2)}
                      </pre>
                    </details>
                  ) : null}
                </li>
              )
            })}
          </ol>
        </div>
      ) : (
        <p className="text-muted-foreground text-[11px]">
          Simulates the graph with mock inputs — no real side effects.
        </p>
      )}
    </section>
  )
}
