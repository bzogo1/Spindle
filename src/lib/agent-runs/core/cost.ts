/**
 * Run cost model + estimator + optimization suggestions (task 81).
 *
 * The model is deliberately simple and provider-agnostic: per-model pricing
 * per 1k tokens, token estimation from recorded event text, and a set of
 * heuristics that turn run shape into actionable suggestions (cache hits,
 * prompt shortening, cheaper model tiers, parallelization).
 */

import { eventContentHash, hashString, runInputHash } from "./hash"
import type { AgentRun, AgentRunEvent, AgentRunMetrics } from "./types"
import { isTerminalRunStatus } from "./types"

/* ------------------------------------------------------------------------ */
/* Pricing                                                                   */
/* ------------------------------------------------------------------------ */

export interface ModelPricing {
  /** USD per 1,000 input tokens. */
  inputPer1k: number
  /** USD per 1,000 output tokens. */
  outputPer1k: number
  /** Rough label used in suggestions. */
  tier: "budget" | "standard" | "premium"
}

/** Known model pricing table (USD per 1k tokens). Extend as needed. */
export const MODEL_PRICING: Record<string, ModelPricing> = {
  "gpt-4o-mini": { inputPer1k: 0.00015, outputPer1k: 0.0006, tier: "budget" },
  "gpt-4o": { inputPer1k: 0.0025, outputPer1k: 0.01, tier: "standard" },
  "gpt-4.1": { inputPer1k: 0.002, outputPer1k: 0.008, tier: "standard" },
  "gpt-4.1-mini": { inputPer1k: 0.0004, outputPer1k: 0.0016, tier: "budget" },
  "claude-haiku": { inputPer1k: 0.0008, outputPer1k: 0.004, tier: "budget" },
  "claude-sonnet": { inputPer1k: 0.003, outputPer1k: 0.015, tier: "premium" },
  "claude-opus": { inputPer1k: 0.015, outputPer1k: 0.075, tier: "premium" },
  default: { inputPer1k: 0.003, outputPer1k: 0.015, tier: "standard" },
}

/** Fallback when the run's model string isn't in the table. */
export const DEFAULT_PRICING: ModelPricing = MODEL_PRICING.default

/** Pricing entries sorted longest-key-first so suffixed ids resolve correctly. */
const PRICING_ENTRIES = Object.entries(MODEL_PRICING)
  .filter(([key]) => key !== "default")
  .sort((a, b) => b[0].length - a[0].length)

/**
 * Resolve pricing for a model id. Exact match first, then substring match
 * against keys sorted longest-first — so "gpt-4.1-mini" matches its own
 * entry before the shorter "gpt-4.1" prefix can claim it — then the default.
 */
export function pricingForModel(model: string): ModelPricing {
  const exact = MODEL_PRICING[model]
  if (exact) return exact
  const lower = model.toLowerCase()
  for (const [key, pricing] of PRICING_ENTRIES) {
    if (lower.includes(key)) return pricing
  }
  return DEFAULT_PRICING
}

/* ------------------------------------------------------------------------ */
/* Token + cost estimation                                                   */
/* ------------------------------------------------------------------------ */

/** Rough token estimate: ~4 chars per token. */
export function estimateTokens(text: string): number {
  if (!text) return 0
  return Math.max(1, Math.ceil(text.length / 4))
}

/** Tokens attributable to one event: explicit `tokens`, else text estimate. */
export function eventTokens(event: AgentRunEvent): number {
  if (typeof event.tokens === "number" && event.tokens > 0) return event.tokens
  const text = [event.name, event.summary ?? "", JSON.stringify(event.payload ?? {})].join(" ")
  return estimateTokens(text)
}

export interface RunCostEstimate {
  inputTokens: number
  outputTokens: number
  totalTokens: number
  costUsd: number
  pricing: ModelPricing
  /** Per-model breakdown when a run recorded multiple models. */
  byModel: Record<string, { tokens: number; costUsd: number }>
}

/**
 * Estimate the cost of a run. Explicit `metrics` win; otherwise tokens are
 * estimated from event text and the prompt. Input tokens are attributed to
 * the prompt; event tokens are treated as output unless `event.tokens` was
 * recorded as input-side usage in `payload.inputTokens`.
 */
export function estimateRunCost(
  run: Pick<AgentRun, "prompt" | "model" | "events" | "metrics">,
  pricing?: ModelPricing,
): RunCostEstimate {
  const resolved = pricing ?? pricingForModel(run.model)

  const metricsTokens = run.metrics.totalTokens ?? run.metrics.inputTokens ?? 0
  const promptTokens = estimateTokens(run.prompt)

  let outputTokens = 0
  const byModel: Record<string, { tokens: number; costUsd: number }> = {}

  for (const event of run.events) {
    const model =
      typeof event.payload?.model === "string" ? (event.payload.model as string) : run.model
    const p = pricingForModel(model)
    const declared =
      typeof event.payload?.inputTokens === "number" ? (event.payload.inputTokens as number) : 0
    const declaredOut =
      typeof event.payload?.outputTokens === "number" ? (event.payload.outputTokens as number) : 0
    const tokens = declared + declaredOut > 0 ? declared + declaredOut : eventTokens(event)
    outputTokens += tokens
    const bucket = (byModel[model] ??= { tokens: 0, costUsd: 0 })
    bucket.tokens += tokens
    // Split the event cost across the model's input/output rates evenly —
    // without per-direction data this is the least surprising approximation.
    bucket.costUsd += (tokens / 2000) * (p.inputPer1k + p.outputPer1k)
  }

  const inputTokens =
    run.metrics.inputTokens !== undefined || run.metrics.outputTokens !== undefined
      ? (run.metrics.inputTokens ?? promptTokens)
      : promptTokens
  const totalTokens =
    run.metrics.totalTokens ?? (metricsTokens > 0 ? metricsTokens : inputTokens + outputTokens)

  const costUsd =
    run.metrics.costUsd ??
    (inputTokens / 1000) * resolved.inputPer1k + (outputTokens / 1000) * resolved.outputPer1k

  return {
    inputTokens,
    outputTokens: run.metrics.outputTokens ?? outputTokens,
    totalTokens,
    costUsd,
    pricing: resolved,
    byModel,
  }
}

/** Recompute a run's metrics from its event log + cost model. */
export function computeRunMetrics(run: AgentRun): AgentRunMetrics {
  const cost = estimateRunCost(run)
  const durationMs = run.metrics.durationMs ?? eventTimeSpan(run.events) ?? undefined
  return {
    ...run.metrics,
    durationMs,
    inputTokens: cost.inputTokens,
    outputTokens: cost.outputTokens,
    totalTokens: cost.totalTokens,
    steps: run.events.filter((e) => e.type === "step" || e.type === "tool").length,
    toolCalls: run.events.filter((e) => e.type === "tool").length,
    costUsd: cost.costUsd,
  }
}

function eventTimeSpan(events: readonly AgentRunEvent[]): number | null {
  if (events.length < 2) return null
  const first = Date.parse(events[0].timestamp)
  const last = Date.parse(events[events.length - 1].timestamp)
  if (Number.isNaN(first) || Number.isNaN(last)) return null
  return Math.max(0, last - first)
}

/* ------------------------------------------------------------------------ */
/* Optimization suggestions                                                  */
/* ------------------------------------------------------------------------ */

export type OptimizationKind = "cache" | "prompt" | "model" | "parallel" | "checkpoint"

export interface RunOptimization {
  id: string
  kind: OptimizationKind
  title: string
  detail: string
  /** Rough USD saved per avoided run, when estimable. */
  estimatedSavingsUsd?: number
  severity: "info" | "warning"
}

export interface SuggestionContext {
  /** Other recorded runs — used to detect repeated prompts (cache hits). */
  allRuns?: readonly AgentRun[]
  /** Prompt length (chars) above which we suggest trimming. Default 4000. */
  longPromptChars?: number
  /** Sequential steps above which we suggest parallelization. Default 4. */
  parallelStepThreshold?: number
}

const LONG_PROMPT_CHARS = 4000
const PARALLEL_STEP_THRESHOLD = 4

/**
 * Produce optimization suggestions for a run. Pure function — the caller
 * supplies any sibling runs for cross-run cache analysis.
 */
export function suggestRunOptimizations(
  run: AgentRun,
  context: SuggestionContext = {},
): RunOptimization[] {
  const suggestions: RunOptimization[] = []
  const cost = estimateRunCost(run)

  // Cache: another run (or this run's own input) has been executed before.
  const hash = runInputHash({ prompt: run.prompt, model: run.model })
  const siblings = (context.allRuns ?? []).filter((r) => r.id !== run.id)
  const duplicates = siblings.filter(
    (r) => runInputHash({ prompt: r.prompt, model: r.model }) === hash,
  )
  if (duplicates.length > 0) {
    const saved = cost.costUsd * duplicates.length
    suggestions.push({
      id: `cache-${hash}`,
      kind: "cache",
      title: "Repeated prompt detected",
      detail: `${duplicates.length} other run(s) used the same prompt and model. Caching the result would avoid re-execution and save ~$${saved.toFixed(4)}.`,
      estimatedSavingsUsd: saved,
      severity: "warning",
    })
  }

  // Prompt length.
  const longPromptChars = context.longPromptChars ?? LONG_PROMPT_CHARS
  if (run.prompt.length > longPromptChars) {
    const ratio = run.prompt.length / longPromptChars
    suggestions.push({
      id: `prompt-${hashString(run.prompt).slice(0, 8)}`,
      kind: "prompt",
      title: "Prompt is long",
      detail: `The prompt is ${run.prompt.length} chars (~${estimateTokens(run.prompt)} tokens). Trimming context or summarizing could cut input cost roughly in proportion.`,
      estimatedSavingsUsd: cost.costUsd * Math.min(0.5, (ratio - 1) * 0.1),
      severity: "info",
    })
  }

  // Model tier: premium model on a cheap/short run.
  if (cost.pricing.tier === "premium" && run.events.length <= 3 && cost.totalTokens < 20_000) {
    const cheaper =
      MODEL_PRICING["claude-sonnet"]?.tier === "premium"
        ? MODEL_PRICING["gpt-4o-mini"]
        : MODEL_PRICING["claude-haiku"]
    const cheaperCost =
      (cost.inputTokens / 1000) * cheaper.inputPer1k +
      (cost.outputTokens / 1000) * cheaper.outputPer1k
    suggestions.push({
      id: `model-${hash}`,
      kind: "model",
      title: "Consider a cheaper model tier",
      detail: `This ${run.model} run is short (${run.events.length} events). A budget-tier model could run it for ~$${cheaperCost.toFixed(4)} instead of ~$${cost.costUsd.toFixed(4)}.`,
      estimatedSavingsUsd: Math.max(0, cost.costUsd - cheaperCost),
      severity: "info",
    })
  }

  // Parallelization: many sequential steps that look independent.
  const stepEvents = run.events.filter((e) => e.type === "step" || e.type === "tool")
  const threshold = context.parallelStepThreshold ?? PARALLEL_STEP_THRESHOLD
  const lanes = new Set(stepEvents.map((e) => e.lane ?? e.name.split(/[./:]/)[0]))
  if (stepEvents.length >= threshold && lanes.size <= 1 && !isTerminalRunStatus(run.status)) {
    suggestions.push({
      id: `parallel-${hash}`,
      kind: "parallel",
      title: "Steps look sequential",
      detail: `${stepEvents.length} steps ran on a single lane. If they are independent, parallel execution could cut wall-clock time significantly.`,
      severity: "info",
    })
  }

  // Checkpointing: long-running runs benefit from snapshots.
  const hasCheckpoints = run.checkpoints.length > 0
  const longRunning = (run.metrics.durationMs ?? 0) > 60_000 || run.events.length > 50
  if (!hasCheckpoints && longRunning) {
    suggestions.push({
      id: `checkpoint-${hash}`,
      kind: "checkpoint",
      title: "No checkpoints recorded",
      detail: `This run has ${run.events.length} events and no checkpoints. Snapshotting state would enable rollback and branching.`,
      severity: "info",
    })
  }

  return suggestions
}

/** Stable fingerprint of an event used for dedupe/conflict checks. */
export function eventFingerprint(event: AgentRunEvent): string {
  return eventContentHash(event)
}
