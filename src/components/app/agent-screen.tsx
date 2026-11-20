"use client"

import { useMemo, useState } from "react"
import { Sparkles } from "lucide-react"

import { EmptyState } from "@/components/app/states/empty-state"
import { useToast } from "@/components/ui/toast"
import { ScreenState } from "@/components/app/states/screen-state"
import {
  AGENT_MODELS,
  AGENT_SCOPES,
  agentConfigLabel,
  agentRequestsRemaining,
  useAgentWorkspace,
} from "@/lib/api"
import type {
  AgentConfig,
  AgentModelId,
  AgentScope,
  AgentStepStatus,
  AgentWorkspaceRun,
} from "@/lib/api"

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

function statusLabel(status: AgentWorkspaceRun["status"]) {
  return status.replace(/_/g, " ")
}

function DiffPanel({
  run,
  onReview,
}: {
  run: AgentWorkspaceRun
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
  const agent = useAgentWorkspace(projectId)
  const { data, actions } = agent
  const [prompt, setPrompt] = useState("")
  const { toast } = useToast()
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)

  const quota = data.quota
  const remaining = agentRequestsRemaining(quota)
  const quotaTotal = quota.dailyLimit + quota.bonus
  const quotaPercent = quotaTotal > 0 ? Math.min(100, (quota.used / quotaTotal) * 100) : 0

  const visibleRun = useMemo(() => {
    const runs = data.runs
    return (
      runs.find((run) => run.id === selectedRunId) ??
      runs.find((run) => run.id === data.activeRunId) ??
      runs[runs.length - 1] ??
      null
    )
  }, [selectedRunId, data.activeRunId, data.runs])

  const updateConfig = async (patch: Partial<AgentConfig>) => {
    const next = { ...data.config, ...patch }
    const result = await actions.updateConfig(next)
    if (!result.ok) toast({ variant: "error", title: result.error })
  }

  const run = async () => {
    if (remaining <= 0) {
      toast({
        variant: "warning",
        title: "Daily agent quota is exhausted. The mock quota resets on reload.",
      })
      return
    }
    const result = await actions.startRun(prompt, data.config)
    if (!result.ok) {
      toast({ variant: "error", title: result.error })
      return
    }
    setSelectedRunId(result.runId)
  }

  const retry = async (target: AgentWorkspaceRun) => {
    const result = await actions.retryRun(target.id)
    if (!result.ok) {
      toast({ variant: "error", title: result.error })
      return
    }
    setSelectedRunId(result.runId)
  }

  const cancel = async (target: AgentWorkspaceRun) => {
    const result = await actions.cancelRun(target.id)
    if (!result.ok) toast({ variant: "error", title: result.error })
  }

  const review = async (target: AgentWorkspaceRun, decision: "approved" | "rejected") => {
    const result = await actions.reviewDiff(target.id, decision)
    if (!result.ok) toast({ variant: "error", title: result.error })
  }

  return (
    <ScreenState
      screen="agent"
      status={agent.status}
      error={agent.error}
      isRetrying={agent.isRetrying}
      onRetry={agent.refetch}
    >
      <div className="app-page">
        <div className="app-page-head">
          <div>
            <h1>Agent</h1>
            <p className="app-page-subtitle">
              Mock agent for {data.project.name} (project {projectId}). Proposals are review-only;
              nothing is written without approval, and approval still does not write in this mock.
            </p>
          </div>
        </div>

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
          <div className="app-agent-config" aria-label="Run configuration">
            <div className="app-field">
              <label htmlFor="agent-model">Model</label>
              <select
                id="agent-model"
                className="app-select"
                value={data.config.model}
                onChange={(event) =>
                  void updateConfig({ model: event.target.value as AgentModelId })
                }
              >
                {AGENT_MODELS.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.label} — {model.hint}
                  </option>
                ))}
              </select>
            </div>
            <div className="app-field">
              <label htmlFor="agent-scope">Run scope</label>
              <select
                id="agent-scope"
                className="app-select"
                value={data.config.scope}
                onChange={(event) => void updateConfig({ scope: event.target.value as AgentScope })}
              >
                {AGENT_SCOPES.map((scope) => (
                  <option key={scope.id} value={scope.id}>
                    {scope.label} — {scope.hint}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <label className="sr-only" htmlFor="agent-prompt">
            Agent prompt
          </label>
          <textarea
            id="agent-prompt"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="Describe the change you want the agent to prepare…"
            rows={3}
          />
          <div className="app-agent-examples" aria-label="Example prompts">
            {EXAMPLES.map((example) => (
              <button
                key={example}
                type="button"
                className="app-chip"
                onClick={() => setPrompt(example)}
              >
                {example}
              </button>
            ))}
          </div>
          <div className="app-agent-composer-actions">
            <button
              type="button"
              className="fm-btn fm-btn--solid"
              onClick={() => void run()}
              disabled={!prompt.trim() || remaining <= 0}
            >
              <Icon name="i-sparkle" /> Run agent
            </button>
            {visibleRun && ["failed", "cancelled", "rejected"].includes(visibleRun.status) ? (
              <button
                type="button"
                className="fm-btn"
                onClick={() => void retry(visibleRun)}
                disabled={remaining <= 0}
              >
                <Icon name="i-refresh" /> Retry run
              </button>
            ) : null}
            {visibleRun && ["running", "waiting_approval"].includes(visibleRun.status) ? (
              <button
                type="button"
                className="fm-btn fm-btn--danger"
                onClick={() => void cancel(visibleRun)}
              >
                Cancel run
              </button>
            ) : null}
          </div>
        </section>

        {data.runs.length > 1 ? (
          <div className="app-agent-history" aria-label="Agent run history">
            {data.runs.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`app-agent-history-item${item.id === visibleRun?.id ? "is-active" : ""}`}
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

        {!visibleRun || agent.isEmpty ? (
          <EmptyState
            icon={<Sparkles aria-hidden="true" />}
            title="No agent runs yet"
            body="Prompt the mock agent above. The trace will appear here with per-step status."
          />
        ) : (
          <section className="app-agent-run" aria-label="Agent run trace">
            <div className="app-agent-run-head">
              <div>
                <strong>{visibleRun.prompt}</strong>
                <span>
                  Run {visibleRun.id} · {statusLabel(visibleRun.status)} ·{" "}
                  {agentConfigLabel(visibleRun.config)}
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
              <DiffPanel
                run={visibleRun}
                onReview={(decision) => void review(visibleRun, decision)}
              />
            ) : null}
          </section>
        )}
      </div>
    </ScreenState>
  )
}
