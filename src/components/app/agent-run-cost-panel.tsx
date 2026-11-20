"use client"

import { Coins } from "lucide-react"

import type { AgentRunLogEntry, AgentRunLogStepKind } from "@/lib/api"

import {
  formatCostUsd,
  formatTokenCount,
  runCostUsd,
  runTotalTokens,
  stepKindLabel,
} from "./agent-run-log-utils"

const STEP_KIND_ORDER: AgentRunLogStepKind[] = ["thought", "tool_call", "result"]

interface KindBreakdown {
  kind: AgentRunLogStepKind
  steps: number
  tokens: number | null
  costUsd: number | null
}

/** Aggregate per-step token/cost fields by step kind for the breakdown list. */
function stepKindBreakdown(run: AgentRunLogEntry): KindBreakdown[] {
  return STEP_KIND_ORDER.map((kind) => {
    const steps = run.steps.filter((step) => step.kind === kind)
    const tokens = steps.reduce<number | null>(
      (sum, step) => (typeof step.tokens === "number" ? (sum ?? 0) + step.tokens : sum),
      null,
    )
    const costUsd = steps.reduce<number | null>(
      (sum, step) => (typeof step.costUsd === "number" ? (sum ?? 0) + step.costUsd : sum),
      null,
    )
    return { kind, steps: steps.length, tokens, costUsd }
  }).filter((row) => row.steps > 0)
}

function orDash(value: number | null, format: (value: number) => string) {
  return value === null ? "—" : format(value)
}

/**
 * Cost & usage panel for a recorded run: reported totals plus a per-step-kind
 * breakdown when steps carry token/cost fields. Renders an empty note when the
 * run has not reported any usage yet.
 */
export function AgentRunCostPanel({ run }: { run: AgentRunLogEntry }) {
  const usage = run.usage
  const costUsd = runCostUsd(run)
  const totalTokens = runTotalTokens(run)
  const breakdown = stepKindBreakdown(run)
  const hasStepMetrics = breakdown.some((row) => row.tokens !== null || row.costUsd !== null)
  const hasUsage =
    usage !== undefined &&
    (costUsd !== null ||
      totalTokens !== null ||
      usage.model !== undefined ||
      usage.provider !== undefined)

  return (
    <section className="app-panel app-cost-panel" aria-labelledby="runlog-cost-heading">
      <div className="app-panel-head">
        <div>
          <h2 id="runlog-cost-heading">
            <Coins aria-hidden="true" className="app-panel-icon" /> Cost &amp; usage
          </h2>
          <p>
            Token and cost metrics reported for this run
            {usage?.model ? ` on ${usage.model}` : ""}.
          </p>
        </div>
      </div>

      {!hasUsage && !hasStepMetrics ? (
        <p className="app-runlog-empty-steps">No usage data recorded for this run yet.</p>
      ) : (
        <>
          <dl className="app-runlog-step-facts app-runlog-cost-facts">
            <div>
              <dt>Cost</dt>
              <dd data-testid="run-cost-usd">{orDash(costUsd, formatCostUsd)}</dd>
            </div>
            <div>
              <dt>Total tokens</dt>
              <dd data-testid="run-cost-tokens">{orDash(totalTokens, formatTokenCount)}</dd>
            </div>
            {usage?.inputTokens !== undefined ? (
              <div>
                <dt>Input tokens</dt>
                <dd>{formatTokenCount(usage.inputTokens)}</dd>
              </div>
            ) : null}
            {usage?.outputTokens !== undefined ? (
              <div>
                <dt>Output tokens</dt>
                <dd>{formatTokenCount(usage.outputTokens)}</dd>
              </div>
            ) : null}
            {usage?.model ? (
              <div>
                <dt>Model</dt>
                <dd>{usage.model}</dd>
              </div>
            ) : null}
            {usage?.provider ? (
              <div>
                <dt>Provider</dt>
                <dd>{usage.provider}</dd>
              </div>
            ) : null}
          </dl>

          {hasStepMetrics ? (
            <div className="app-runlog-cost-breakdown" data-testid="run-cost-breakdown">
              <h3 className="app-runlog-cost-breakdown-title">By step kind</h3>
              <ul>
                {breakdown.map((row) => (
                  <li key={row.kind}>
                    <span className="app-runlog-cost-kind">
                      {stepKindLabel(row.kind)}
                      <small>
                        {row.steps} step{row.steps === 1 ? "" : "s"}
                      </small>
                    </span>
                    <span className="app-runlog-cost-values">
                      <span>{orDash(row.tokens, formatTokenCount)} tokens</span>
                      <strong>{orDash(row.costUsd, formatCostUsd)}</strong>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </>
      )}
    </section>
  )
}
