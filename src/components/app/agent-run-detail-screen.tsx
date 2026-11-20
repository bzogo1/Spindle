"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { ArrowLeft, Brain, Flag, ShieldAlert, Wrench } from "lucide-react"

import { ScreenState } from "@/components/app/states/screen-state"
import { useAgentRunLogEntry } from "@/lib/api"
import type { AgentRunApprovalStatus, AgentRunLogEntry, AgentRunLogStep } from "@/lib/api"

import { formatDateTime, formatRelativeTime } from "./format"
import { AgentRunCancelButton } from "./agent-run-cancel"
import { AgentRunReplayButton } from "./agent-run-replay"
import { AgentRunShareButton } from "./agent-run-share"
import { AgentRunStreamPanel } from "./agent-run-stream-panel"
import { AgentRunCostPanel } from "./agent-run-cost-panel"
import { AgentRunBadge, useNow } from "./agent-run-log-shared"
import {
  formatCostUsd,
  formatDurationMs,
  isActiveRun,
  runDurationMs,
  stepKindLabel,
} from "./agent-run-log-utils"
import { CopyButton } from "./copy-button"

function stepIcon(kind: AgentRunLogStep["kind"]) {
  if (kind === "thought") return <Brain aria-hidden="true" />
  if (kind === "tool_call") return <Wrench aria-hidden="true" />
  return <Flag aria-hidden="true" />
}

function approvalStatusLabel(status: AgentRunApprovalStatus) {
  return status === "pending" ? "Awaiting decision" : status
}

function ApprovalCard({ approval }: { approval: NonNullable<AgentRunLogEntry["approval"]> }) {
  const [decision, setDecision] = useState<"approved" | "rejected" | null>(null)
  const pending = approval.status === "pending" && decision === null

  return (
    <section className="app-panel app-approval-card" aria-label="Approval request">
      <div className="app-panel-head">
        <div>
          <h2>
            <ShieldAlert aria-hidden="true" className="app-panel-icon" /> Approval required
          </h2>
          <p>
            {approval.action.replace(/_/g, " ")} · requested{" "}
            {formatRelativeTime(approval.requestedAt)}
          </p>
        </div>
        <span className={`app-badge is-${decision ?? approval.status}`}>
          {approvalStatusLabel(decision ?? approval.status)}
        </span>
      </div>
      <p className="app-approval-summary">{approval.summary}</p>
      {pending ? (
        <div className="app-approval-actions">
          <button
            type="button"
            className="fm-btn fm-btn--solid"
            onClick={() => setDecision("approved")}
          >
            Approve
          </button>
          <button
            type="button"
            className="fm-btn fm-btn--danger"
            onClick={() => setDecision("rejected")}
          >
            Reject
          </button>
          <span className="app-approval-note">
            Demo only — decisions are not sent anywhere yet.
          </span>
        </div>
      ) : decision ? (
        <p className="app-approval-note" role="status">
          Decision recorded locally as “{decision}”. Nothing was executed — this is a UI demo.
        </p>
      ) : null}
    </section>
  )
}

function TimelineStep({ step, now }: { step: AgentRunLogStep; now: number }) {
  const live = step.status === "running"
  const duration =
    step.durationMs ?? (live ? Math.max(0, now - new Date(step.startedAt).getTime()) : null)
  const payloadJson = useMemo(
    () => (step.payload ? JSON.stringify(step.payload, null, 2) : null),
    [step.payload],
  )

  return (
    <li className={`app-runlog-step is-${step.status}`}>
      <details className="app-runlog-step-details">
        <summary>
          <span className="app-runlog-step-icon" aria-hidden="true">
            {stepIcon(step.kind)}
          </span>
          <span className="app-runlog-step-kind">{stepKindLabel(step.kind)}</span>
          <span className="app-runlog-step-main">
            <strong>{step.title}</strong>
            <small>{step.detail}</small>
          </span>
          <span className="app-runlog-step-meta">
            {duration !== null ? <span>{formatDurationMs(duration)}</span> : null}
            {step.costUsd !== undefined ? (
              <span className="app-runlog-cost">{formatCostUsd(step.costUsd)}</span>
            ) : null}
            <span className={`app-badge is-${step.status}`}>{step.status}</span>
          </span>
        </summary>
        <div className="app-runlog-step-body">
          <dl className="app-runlog-step-facts">
            <div>
              <dt>Started</dt>
              <dd>{formatDateTime(step.startedAt)}</dd>
            </div>
            <div>
              <dt>Kind</dt>
              <dd>{stepKindLabel(step.kind)}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>{step.status}</dd>
            </div>
            {step.tokens !== undefined ? (
              <div>
                <dt>Tokens</dt>
                <dd>{step.tokens.toLocaleString()}</dd>
              </div>
            ) : null}
            {step.costUsd !== undefined ? (
              <div>
                <dt>Cost</dt>
                <dd>{formatCostUsd(step.costUsd)}</dd>
              </div>
            ) : null}
          </dl>
          {payloadJson ? (
            <div className="app-runlog-payload-wrap">
              <CopyButton text={payloadJson} label="Copy payload" />
              <pre className="app-runlog-payload">{payloadJson}</pre>
            </div>
          ) : null}
        </div>
      </details>
    </li>
  )
}

function RunDebugPanel({ run }: { run: AgentRunLogEntry }) {
  const rawJson = useMemo(() => JSON.stringify(run, null, 2), [run])

  // Built lazily on click so `capturedAt` reflects the moment of the copy.
  const debugInfo = () =>
    JSON.stringify(
      {
        capturedAt: new Date().toISOString(),
        page: typeof window === "undefined" ? null : window.location.href,
        run,
      },
      null,
      2,
    )

  return (
    <section className="app-panel" aria-labelledby="runlog-debug-heading">
      <div className="app-panel-head">
        <div>
          <h2 id="runlog-debug-heading">Debug</h2>
          <p>
            Raw payloads for troubleshooting — the full run record as JSON, or a copyable debug
            bundle with the page URL and capture time.
          </p>
        </div>
        <CopyButton text={debugInfo} label="Copy debug info" />
      </div>
      <details className="app-runlog-debug-details">
        <summary>Raw run JSON</summary>
        <pre className="app-runlog-payload">{rawJson}</pre>
      </details>
    </section>
  )
}

export function AgentRunDetailScreen({ runId }: { runId: string }) {
  const query = useAgentRunLogEntry(runId)
  const active = query.data ? isActiveRun(query.data.status) : false
  const now = useNow(active ? 1000 : 30_000)

  return (
    <ScreenState
      screen="agent"
      status={query.status}
      data={query.data}
      error={query.error}
      isRetrying={query.isRetrying}
      onRetry={query.refetch}
    >
      {(run) => {
        const duration = runDurationMs(run, now)
        return (
          <div className="app-page">
            <Link href="/app/agent" className="app-runlog-back">
              <ArrowLeft aria-hidden="true" /> All agent runs
            </Link>

            <div className="app-page-head">
              <div>
                <h1>{run.prompt}</h1>
                <p className="app-page-subtitle">
                  Run{" "}
                  <span className="app-runlog-id">
                    <code>{run.id}</code>
                    <CopyButton text={run.id} label="Copy ID" />
                  </span>{" "}
                  in <Link href={`/projects/${run.projectId}`}>{run.projectName}</Link> · started by{" "}
                  {run.actor.name} · {formatRelativeTime(run.createdAt, now)}
                </p>
              </div>
              <div className="app-runlog-head-status">
                <AgentRunBadge status={run.status} />
                {duration !== null ? (
                  <span className="app-runlog-duration">
                    {isActiveRun(run.status) ? "Elapsed" : "Duration"} {formatDurationMs(duration)}
                  </span>
                ) : null}
                <AgentRunCancelButton run={run} onCancelled={query.refetch} />
                <AgentRunReplayButton run={run} />
                <AgentRunShareButton run={run} />
              </div>
            </div>

            <AgentRunStreamPanel runId={run.id} enabled={isActiveRun(run.status)} />

            <AgentRunCostPanel run={run} />

            {run.approval ? <ApprovalCard approval={run.approval} /> : null}

            <section className="app-panel" aria-labelledby="runlog-timeline-heading">
              <div className="app-panel-head">
                <div>
                  <h2 id="runlog-timeline-heading">Timeline</h2>
                  <p>
                    {run.steps.length} step{run.steps.length === 1 ? "" : "s"} — thoughts, tool
                    calls, and results in order. Expand a row for details.
                  </p>
                </div>
              </div>

              {run.steps.length === 0 ? (
                <p className="app-runlog-empty-steps">No steps recorded for this run yet.</p>
              ) : (
                <ol className="app-runlog-steps">
                  {run.steps.map((step) => (
                    <TimelineStep key={step.id} step={step} now={now} />
                  ))}
                </ol>
              )}

              {run.summary ? <p className="app-agent-summary">{run.summary}</p> : null}
            </section>

            <RunDebugPanel run={run} />
          </div>
        )
      }}
    </ScreenState>
  )
}
