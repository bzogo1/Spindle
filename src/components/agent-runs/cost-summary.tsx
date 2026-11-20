"use client"

import { Coins, Lightbulb, TriangleAlert } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import {
  estimateRunCost,
  suggestRunOptimizations,
  type AgentRun,
  type RunOptimization,
} from "@/lib/agent-runs/core"

function formatUsd(usd: number): string {
  if (usd < 0.01) return `$${usd.toFixed(4)}`
  return `$${usd.toFixed(2)}`
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

const KIND_LABELS: Record<RunOptimization["kind"], string> = {
  cache: "Cache",
  prompt: "Prompt",
  model: "Model",
  parallel: "Parallel",
  checkpoint: "Checkpoint",
}

export interface RunCostSummaryProps {
  run: AgentRun
  /** Sibling runs for cross-run cache analysis. */
  allRuns?: readonly AgentRun[]
}

/**
 * Cost estimate + optimization suggestions panel for a recorded run.
 * Presentational; all computation lives in `src/lib/agent-runs/core/cost`.
 */
export function RunCostSummary({ run, allRuns }: RunCostSummaryProps) {
  const estimate = estimateRunCost(run)
  const suggestions = suggestRunOptimizations(run, { allRuns })
  const durationMs = run.metrics.durationMs

  return (
    <section
      aria-label="Run cost summary"
      className="bg-card text-card-foreground rounded-lg border"
      data-testid="run-cost-summary"
    >
      <header className="flex items-center gap-2 border-b px-4 py-3">
        <Coins className="text-muted-foreground size-4" aria-hidden />
        <h3 className="text-sm font-medium">Cost &amp; efficiency</h3>
      </header>

      <dl className="grid grid-cols-2 gap-3 px-4 py-3 sm:grid-cols-4">
        <div>
          <dt className="text-muted-foreground text-xs">Est. cost</dt>
          <dd className="text-sm font-semibold" data-testid="cost-usd">
            {formatUsd(estimate.costUsd)}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground text-xs">Tokens</dt>
          <dd className="text-sm font-semibold" data-testid="cost-tokens">
            {formatTokens(estimate.totalTokens)}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground text-xs">Model tier</dt>
          <dd className="text-sm font-semibold capitalize">{estimate.pricing.tier}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground text-xs">Duration</dt>
          <dd className="text-sm font-semibold" data-testid="cost-duration">
            {durationMs !== undefined ? `${(durationMs / 1000).toFixed(1)}s` : "—"}
          </dd>
        </div>
      </dl>

      {suggestions.length === 0 ? (
        <p className="text-muted-foreground border-t px-4 py-4 text-sm">
          No optimization opportunities detected for this run.
        </p>
      ) : (
        <ul className="divide-y border-t">
          {suggestions.map((suggestion) => (
            <li key={suggestion.id} className="flex items-start gap-3 px-4 py-3">
              {suggestion.severity === "warning" ? (
                <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-500" aria-hidden />
              ) : (
                <Lightbulb className="text-muted-foreground mt-0.5 size-4 shrink-0" aria-hidden />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{suggestion.title}</span>
                  <Badge variant="outline" size="sm">
                    {KIND_LABELS[suggestion.kind]}
                  </Badge>
                  {suggestion.estimatedSavingsUsd !== undefined ? (
                    <Badge variant="secondary" size="sm">
                      save ~{formatUsd(suggestion.estimatedSavingsUsd)}
                    </Badge>
                  ) : null}
                </div>
                <p className="text-muted-foreground mt-1 text-xs">{suggestion.detail}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
