"use client"

import Link from "next/link"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import type { AgentRunLogEntry } from "@/lib/api"

import { formatDateTime } from "./format"
import { AgentRunBadge } from "./agent-run-log-shared"
import {
  formatCostUsd,
  formatDurationMs,
  formatTokenCount,
  runCostUsd,
  runDurationMs,
  runTotalTokens,
} from "./agent-run-log-utils"

function approvalSummary(run: AgentRunLogEntry) {
  if (!run.approval) return "None"
  return `${run.approval.action.replace(/_/g, " ")} · ${run.approval.status}`
}

function orDash(value: string | null) {
  return value ? value : "—"
}

function CompareColumn({
  run,
  now,
  side,
}: {
  run: AgentRunLogEntry
  now: number
  side: "first" | "second"
}) {
  const duration = runDurationMs(run, now)
  const costUsd = runCostUsd(run)
  const totalTokens = runTotalTokens(run)
  return (
    <section className="app-runlog-compare-col" aria-label={`Run ${side}: ${run.prompt}`}>
      <h3 className="app-runlog-compare-prompt">{run.prompt}</h3>
      <p className="app-runlog-compare-id">
        <code>{run.id}</code>
      </p>
      <dl className="app-runlog-compare-facts">
        <div>
          <dt>Status</dt>
          <dd>
            <AgentRunBadge status={run.status} />
          </dd>
        </div>
        <div>
          <dt>Project</dt>
          <dd>{run.projectName}</dd>
        </div>
        <div>
          <dt>Actor</dt>
          <dd>{run.actor.name}</dd>
        </div>
        <div>
          <dt>Duration</dt>
          <dd>{duration === null ? "—" : formatDurationMs(duration)}</dd>
        </div>
        <div>
          <dt>Cost</dt>
          <dd>{costUsd === null ? "—" : formatCostUsd(costUsd)}</dd>
        </div>
        <div>
          <dt>Tokens</dt>
          <dd>{totalTokens === null ? "—" : formatTokenCount(totalTokens)}</dd>
        </div>
        <div>
          <dt>Steps</dt>
          <dd>{run.steps.length}</dd>
        </div>
        <div>
          <dt>Approval</dt>
          <dd>{approvalSummary(run)}</dd>
        </div>
        <div>
          <dt>Created</dt>
          <dd>{formatDateTime(run.createdAt)}</dd>
        </div>
        <div>
          <dt>Started</dt>
          <dd>{run.startedAt ? formatDateTime(run.startedAt) : "—"}</dd>
        </div>
        <div>
          <dt>Finished</dt>
          <dd>{run.finishedAt ? formatDateTime(run.finishedAt) : "—"}</dd>
        </div>
        <div>
          <dt>Summary</dt>
          <dd>{orDash(run.summary)}</dd>
        </div>
      </dl>
      <Link href={`/app/agent/${run.id}`} className="app-runlog-compare-link">
        Open run detail
      </Link>
    </section>
  )
}

export function AgentRunCompareDialog({
  runs,
  open,
  onOpenChange,
  now,
}: {
  runs: AgentRunLogEntry[]
  open: boolean
  onOpenChange: (open: boolean) => void
  now: number
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="app-runlog-compare-dialog sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Compare agent runs</DialogTitle>
          <DialogDescription>
            Side-by-side summary of the two selected runs. Open a run for its full step trace.
          </DialogDescription>
        </DialogHeader>
        {runs.length === 2 ? (
          <div className="app-runlog-compare-grid">
            <CompareColumn run={runs[0]} now={now} side="first" />
            <CompareColumn run={runs[1]} now={now} side="second" />
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
