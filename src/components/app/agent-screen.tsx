"use client"

import { useEffect, useMemo, useState } from "react"

import { useMockStore } from "@/components/app/mock-store-provider"
import { agentRequestsRemaining, type AgentRun, type AgentStepStatus } from "@/lib/project-store"

function Icon({ name, className = "icon icon--xs" }: { name: string; className?: string }) {
  return (
    <svg className={className} aria-hidden="true">
      <use href={`#${name}`} />
    </svg>
  )
}

const EXAMPLES = [
  "Summarize the latest field notes and flag missing sites",
  "Add a review_status column to the tidal export",
  "Find notebooks that read survey.parquet",
]

function stepIcon(status: AgentStepStatus) {
  if (status === "done") return "i-check"
  if (status === "running") return "i-play"
  if (status === "failed") return "i-refresh"
  if (status === "cancelled") return "i-close"
  return "i-clock"
}

function statusLabel(status: AgentRun["status"]) {
  return status.replace(/_/g, " ")
}

function DiffPanel({
  run,
  onReview,
}: {
  run: AgentRun
  onReview: (decision: "approved" | "rejected") => void
}) {
  const diff = run.diff
  if (!diff) return null

  return (
    <section className="app-agent-diff" aria-label={`Diff review for ${diff.path}`}>
      <div className="app-agent-diff-head">
        <div>
          <strong>{diff.path}</strong>
          <span>{diff.summary}</span>
        </div>
        <div className="app-agent-diff-counts">
          <span className="app-diff-add">+{diff.additions}</span>
          <span className="app-diff-del">−{diff.deletions}</span>
        </div>
      </div>
      <div className="app-agent-diff-grid">
        <div className="app-agent-diff-col">
          <div className="app-agent-diff-title">Current</div>
          <pre>
            {diff.before.map((line, index) => (
              <span key={`${index}-${line}`} className="app-diff-line app-diff-line--before">
                {line}
              </span>
            ))}
          </pre>
        </div>
        <div className="app-agent-diff-col">
          <div className="app-agent-diff-title">Proposed</div>
          <pre>
            {diff.after.map((line, index) => (
              <span key={`${index}-${line}`} className="app-diff-line app-diff-line--after">
                {line}
              </span>
            ))}
          </pre>
        </div>
      </div>
      <div className="app-agent-diff-actions">
        {run.status === "waiting_approval" && diff.review === "pending" ? (
          <>
            <button
              type="button"
              className="fm-btn fm-btn--solid"
              onClick={() => onReview("approved")}
            >
              Approve diff
            </button>
            <button
              type="button"
              className="fm-btn fm-btn--danger"
              onClick={() => onReview("rejected")}
            >
              Reject diff
            </button>
          </>
        ) : (
          <span className="app-agent-diff-state">
            Review state: <strong>{diff.review}</strong>. No files were written.
          </span>
        )}
      </div>
    </section>
  )
}

export function AgentScreen({ projectId }: { projectId: string }) {
  const { store, state, ready } = useMockStore()
  const [notice, setNotice] = useState("")
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)

  const quota = state.agent.quota
  const remaining = agentRequestsRemaining(quota)
  const quotaTotal = quota.dailyLimit + quota.bonus
  const quotaPercent = quotaTotal > 0 ? Math.min(100, (quota.used / quotaTotal) * 100) : 0
  const hasRunning = state.agent.runs.some((run) => run.status === "running")

  const visibleRun = useMemo(() => {
    const runs = state.agent.runs
    return (
      runs.find((run) => run.id === selectedRunId) ??
      runs.find((run) => run.id === state.agent.activeRunId) ??
      runs[runs.length - 1] ??
      null
    )
  }, [selectedRunId, state.agent.activeRunId, state.agent.runs])

  useEffect(() => {
    if (!hasRunning) return
    const interval = window.setInterval(() => store.advanceAgentRuns(), 700)
    return () => window.clearInterval(interval)
  }, [hasRunning, store])

  const run = () => {
    if (remaining <= 0) {
      setNotice("Daily agent quota is exhausted. The mock quota resets on reload.")
      return
    }
    const next = store.runAgent()
    if (!next) {
      setNotice("The agent could not start a run.")
      return
    }
    setSelectedRunId(next.id)
    setNotice("")
  }

  const retry = (target: AgentRun) => {
    const next = store.retryAgentRun(target.id)
    if (!next) {
      setNotice("Retry is unavailable — quota may be exhausted or the run is still active.")
      return
    }
    setSelectedRunId(next.id)
    setNotice("")
  }

  const cancel = (target: AgentRun) => {
    const result = store.cancelAgentRun(target.id)
    setNotice(result.ok ? "" : result.error)
  }

  const review = (target: AgentRun, decision: "approved" | "rejected") => {
    const result = store.reviewAgentDiff(target.id, decision)
    setNotice(result.ok ? "" : result.error)
  }

  if (!ready) {
    return (
      <div className="app-page">
        <div className="app-page-head">
          <div>
            <h1>Agent</h1>
            <p className="app-page-subtitle">Loading mock agent state…</p>
          </div>
        </div>
        <div className="app-loading" aria-label="Loading agent">
          <span />
          <span />
          <span />
        </div>
      </div>
    )
  }

  return (
    <div className="app-page">
      <div className="app-page-head">
        <div>
          <h1>Agent</h1>
          <p className="app-page-subtitle">
            Mock agent for {state.project.name} (project {projectId}). Proposals are review-only;
            nothing is written without approval, and approval still does not write in this mock.
          </p>
        </div>
      </div>

      {notice ? (
        <div className="app-alert app-alert--error" role="alert">
          {notice}
        </div>
      ) : null}
      {remaining <= 0 ? (
        <div className="app-alert app-alert--warning" role="status">
          Agent quota is exhausted for this mock session. Reloading resets it.
        </div>
      ) : null}

      <section className="app-agent-composer" aria-label="Agent prompt">
        <div className="app-agent-quota">
          <div className="app-agent-quota-label">
            <span>Daily quota</span>
            <strong>
              {remaining} of {quotaTotal} requests left
            </strong>
          </div>
          <div
            className="app-progress"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={quotaTotal}
            aria-valuenow={quota.used}
            aria-label="Agent quota used"
          >
            <span style={{ width: `${quotaPercent}%` }} />
          </div>
        </div>
        <label className="sr-only" htmlFor="agent-prompt">
          Agent prompt
        </label>
        <textarea
          id="agent-prompt"
          value={state.agent.prompt}
          onChange={(event) => store.setAgentPrompt(event.target.value)}
          placeholder="Describe the change you want the agent to prepare…"
          rows={3}
        />
        <div className="app-agent-examples" aria-label="Example prompts">
          {EXAMPLES.map((example) => (
            <button
              key={example}
              type="button"
              className="app-chip"
              onClick={() => store.setAgentPrompt(example)}
            >
              {example}
            </button>
          ))}
        </div>
        <div className="app-agent-composer-actions">
          <button
            type="button"
            className="fm-btn fm-btn--solid"
            onClick={run}
            disabled={!state.agent.prompt.trim() || remaining <= 0}
          >
            <Icon name="i-sparkle" /> Run agent
          </button>
          {visibleRun && ["failed", "cancelled", "rejected"].includes(visibleRun.status) ? (
            <button
              type="button"
              className="fm-btn"
              onClick={() => retry(visibleRun)}
              disabled={remaining <= 0}
            >
              <Icon name="i-refresh" /> Retry run
            </button>
          ) : null}
          {visibleRun && ["running", "waiting_approval"].includes(visibleRun.status) ? (
            <button
              type="button"
              className="fm-btn fm-btn--danger"
              onClick={() => cancel(visibleRun)}
            >
              Cancel run
            </button>
          ) : null}
        </div>
      </section>

      {state.agent.runs.length > 1 ? (
        <div className="app-agent-history" aria-label="Agent run history">
          {state.agent.runs.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`app-agent-history-item${item.id === visibleRun?.id ? " is-active" : ""}`}
              onClick={() => setSelectedRunId(item.id)}
            >
              <span>
                {item.prompt.slice(0, 42)}
                {item.prompt.length > 42 ? "…" : ""}
              </span>
              <span className={`app-badge is-${item.status}`}>{statusLabel(item.status)}</span>
            </button>
          ))}
        </div>
      ) : null}

      {!visibleRun ? (
        <div className="app-state">
          <Icon name="i-sparkle" className="icon" />
          <h2>No agent runs yet</h2>
          <p>Prompt the mock agent above. The trace will appear here with per-step status.</p>
        </div>
      ) : (
        <section className="app-agent-run" aria-label="Agent run trace">
          <div className="app-agent-run-head">
            <div>
              <strong>{visibleRun.prompt}</strong>
              <span>
                Run {visibleRun.id} · {statusLabel(visibleRun.status)}
                {visibleRun.retryOf ? ` · retry of ${visibleRun.retryOf}` : ""}
              </span>
            </div>
            <span className={`app-badge is-${visibleRun.status}`}>
              {statusLabel(visibleRun.status)}
            </span>
          </div>

          <ol className="app-agent-steps">
            {visibleRun.steps.map((step) => (
              <li key={step.id} className={`app-agent-step is-${step.status}`}>
                <span className="app-agent-step-icon" aria-hidden="true">
                  <Icon name={stepIcon(step.status)} />
                </span>
                <div>
                  <strong>{step.label}</strong>
                  <span>{step.detail}</span>
                  {step.durationMs ? <em>{(step.durationMs / 1000).toFixed(1)}s</em> : null}
                </div>
                <span className="app-agent-step-status">{step.status}</span>
              </li>
            ))}
          </ol>

          {visibleRun.summary ? <p className="app-agent-summary">{visibleRun.summary}</p> : null}

          {visibleRun.diff ? (
            <DiffPanel run={visibleRun} onReview={(decision) => review(visibleRun, decision)} />
          ) : null}
        </section>
      )}
    </div>
  )
}
