"use client"

import { useState } from "react"
import { Activity, Download, Trash2 } from "lucide-react"

import {
  clearAutomationRuns,
  readAutomationRuns,
  useAutomationRunMetrics,
  type AutomationRunRecord,
} from "@/lib/automation-graph"
import { formatRelativeTime } from "@/components/app/format"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

import { automationRunRecordsToCsv, downloadCsvFile } from "./run-log-csv"

interface MonitoringPanelProps {
  /** localStorage scope for the run log (same scope as version history). */
  scope: string
}

const STATUS_CLASS: Record<string, string> = {
  success: "border-emerald-500/40 text-emerald-600",
  error: "border-red-500/40 text-red-600",
  rejected: "border-amber-500/40 text-amber-600",
}

function RunRow({ run }: { run: AutomationRunRecord }) {
  return (
    <li className="border-border/60 flex items-center gap-2 rounded border px-1.5 py-1">
      <Badge variant="outline" className={cn("text-[9px]", STATUS_CLASS[run.status])}>
        {run.status}
      </Badge>
      <span className="min-w-0 flex-1 truncate text-[11px]">{run.graphName}</span>
      <span className="text-muted-foreground shrink-0 text-[9px]">
        {run.succeeded}/{run.total} ok · {run.durationMs}ms · {formatRelativeTime(run.ranAt)}
      </span>
    </li>
  )
}

/**
 * Run monitoring dashboard fed by the local run log: execution counts,
 * success/failure rate, last-run status, and duration stats.
 */
export function MonitoringPanel({ scope }: MonitoringPanelProps) {
  const metrics = useAutomationRunMetrics(scope, 8)
  const [confirmClear, setConfirmClear] = useState(false)

  const successPct = Math.round(metrics.successRate * 100)

  return (
    <section
      className="border-border bg-card flex flex-col gap-2 rounded-lg border p-3"
      aria-labelledby="builder-monitoring-heading"
    >
      <div className="flex items-center justify-between gap-2">
        <h3
          id="builder-monitoring-heading"
          className="text-muted-foreground flex items-center gap-1.5 text-xs font-semibold tracking-wide uppercase"
        >
          <Activity className="size-3.5" aria-hidden="true" />
          Monitoring
        </h3>
        <div className="flex items-center gap-1">
          {metrics.totalRuns > 0 ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 px-1.5 text-[10px]"
              aria-label="Export run log as CSV"
              onClick={() => {
                const slug = scope.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "") || "runs"
                downloadCsvFile(`${slug}-run-log.csv`, automationRunRecordsToCsv(readAutomationRuns(scope)))
              }}
            >
              <Download aria-hidden="true" />
              CSV
            </Button>
          ) : null}
          {metrics.totalRuns > 0 ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 px-1.5 text-[10px]"
              onClick={() => {
                if (confirmClear) {
                  clearAutomationRuns(scope)
                  setConfirmClear(false)
                } else {
                  setConfirmClear(true)
                  setTimeout(() => setConfirmClear(false), 3000)
                }
              }}
            >
              <Trash2 aria-hidden="true" />
              {confirmClear ? "Confirm clear" : "Clear"}
            </Button>
          ) : null}
        </div>
      </div>

      {metrics.totalRuns === 0 ? (
        <p className="text-muted-foreground text-[11px]">
          No runs recorded yet. Run a dry run to start collecting metrics.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-1.5 text-center">
            <div className="border-border/60 rounded border p-1.5">
              <p className="text-sm font-semibold">{metrics.totalRuns}</p>
              <p className="text-muted-foreground text-[9px]">total runs</p>
            </div>
            <div className="border-border/60 rounded border p-1.5">
              <p
                className={cn(
                  "text-sm font-semibold",
                  metrics.successRate >= 0.8
                    ? "text-emerald-600"
                    : metrics.successRate >= 0.5
                      ? "text-amber-600"
                      : "text-red-600",
                )}
              >
                {successPct}%
              </p>
              <p className="text-muted-foreground text-[9px]">success rate</p>
            </div>
            <div className="border-border/60 rounded border p-1.5">
              <p className="text-sm font-semibold">{metrics.avgDurationMs}ms</p>
              <p className="text-muted-foreground text-[9px]">avg duration</p>
            </div>
            <div className="border-border/60 rounded border p-1.5">
              <p className="text-sm font-semibold">{metrics.failureCount}</p>
              <p className="text-muted-foreground text-[9px]">failures</p>
            </div>
          </div>

          <p className="text-muted-foreground text-[10px]">
            Last run:{" "}
            <span className="text-foreground font-medium">{metrics.lastStatus ?? "—"}</span>
            {metrics.lastRunAt ? ` · ${formatRelativeTime(metrics.lastRunAt)}` : ""} · max{" "}
            {metrics.maxDurationMs}ms
          </p>

          <ul className="flex max-h-40 flex-col gap-1 overflow-y-auto">
            {metrics.recent.map((run) => (
              <RunRow key={run.id} run={run} />
            ))}
          </ul>
        </>
      )}
    </section>
  )
}
