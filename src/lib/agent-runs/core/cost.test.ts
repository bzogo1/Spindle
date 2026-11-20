import { describe, expect, it } from "vitest"

import {
  computeRunMetrics,
  DEFAULT_PRICING,
  estimateRunCost,
  estimateTokens,
  MODEL_PRICING,
  pricingForModel,
  suggestRunOptimizations,
} from "./cost"
import type { AgentRunEvent } from "./types"
import { makeEvent, makeRun } from "./fixtures"

function event(overrides: Partial<AgentRunEvent> = {}): AgentRunEvent {
  return makeEvent(overrides)
}

describe("estimateTokens", () => {
  it("estimates ~4 chars per token", () => {
    expect(estimateTokens("")).toBe(0)
    expect(estimateTokens("abcd")).toBe(1)
    expect(estimateTokens("a".repeat(400))).toBe(100)
  })
})

describe("pricingForModel", () => {
  it("resolves exact, substring, and default pricing", () => {
    expect(pricingForModel("gpt-4o")).toBe(MODEL_PRICING["gpt-4o"])
    expect(pricingForModel("openai/gpt-4o-mini")).toBe(MODEL_PRICING["gpt-4o-mini"])
    expect(pricingForModel("unknown-model")).toBe(DEFAULT_PRICING)
  })

  it("resolves suffixed model ids to the longest matching key", () => {
    // "gpt-4.1-mini" must not be claimed by the shorter "gpt-4.1" prefix.
    expect(pricingForModel("openai/gpt-4.1-mini-2025")).toBe(MODEL_PRICING["gpt-4.1-mini"])
    expect(pricingForModel("gpt-4o-mini-latest")).toBe(MODEL_PRICING["gpt-4o-mini"])
    expect(pricingForModel("gpt-4.1-nano")).toBe(MODEL_PRICING["gpt-4.1"])
  })
})

describe("estimateRunCost", () => {
  it("uses explicit metrics when present", () => {
    const run = makeRun({
      metrics: { totalTokens: 1000, inputTokens: 400, outputTokens: 600, costUsd: 0.42 },
    })
    const estimate = estimateRunCost(run)
    expect(estimate.costUsd).toBe(0.42)
    expect(estimate.totalTokens).toBe(1000)
  })

  it("estimates tokens from prompt and events", () => {
    const run = makeRun({
      prompt: "a".repeat(400), // 100 tokens
      events: [event({ tokens: 50 }), event({ id: "e2", seq: 2, tokens: 50 })],
    })
    const estimate = estimateRunCost(run)
    expect(estimate.inputTokens).toBe(100)
    expect(estimate.outputTokens).toBe(100)
    expect(estimate.totalTokens).toBe(200)
    expect(estimate.costUsd).toBeGreaterThan(0)
  })
})

describe("computeRunMetrics", () => {
  it("derives steps, tool calls, tokens, and cost", () => {
    const run = makeRun({
      events: [
        event({ id: "a", seq: 1, type: "step", name: "plan" }),
        event({ id: "b", seq: 2, type: "tool", name: "search", tokens: 10 }),
        event({ id: "c", seq: 3, type: "message", name: "say", tokens: 5 }),
      ],
    })
    const metrics = computeRunMetrics(run)
    expect(metrics.steps).toBe(2)
    expect(metrics.toolCalls).toBe(1)
    expect(metrics.totalTokens).toBeGreaterThan(0)
    expect(metrics.costUsd).toBeGreaterThan(0)
  })
})

describe("suggestRunOptimizations", () => {
  it("suggests caching when a sibling run has the same input", () => {
    const run = makeRun()
    const sibling = makeRun({ id: "run_2" })
    const suggestions = suggestRunOptimizations(run, { allRuns: [sibling] })
    const cache = suggestions.find((s) => s.kind === "cache")
    expect(cache).toBeDefined()
    expect(cache!.estimatedSavingsUsd).toBeGreaterThan(0)
  })

  it("does not suggest caching for unique prompts", () => {
    const run = makeRun()
    const sibling = makeRun({ id: "run_2", prompt: "different prompt" })
    const suggestions = suggestRunOptimizations(run, { allRuns: [sibling] })
    expect(suggestions.find((s) => s.kind === "cache")).toBeUndefined()
  })

  it("suggests prompt trimming for long prompts", () => {
    const run = makeRun({ prompt: "x".repeat(5000) })
    const suggestions = suggestRunOptimizations(run)
    expect(suggestions.some((s) => s.kind === "prompt")).toBe(true)
  })

  it("suggests a cheaper model tier for short premium runs", () => {
    const run = makeRun({
      model: "claude-opus",
      events: [event(), event({ id: "e2", seq: 2 }), event({ id: "e3", seq: 3 })],
    })
    const suggestions = suggestRunOptimizations(run)
    expect(suggestions.some((s) => s.kind === "model")).toBe(true)
  })

  it("suggests parallelization for long single-lane sequential runs", () => {
    const events = Array.from({ length: 6 }, (_, i) =>
      event({ id: `e${i}`, seq: i + 1, name: `seq.step${i}` }),
    )
    const run = makeRun({ status: "running", events })
    const suggestions = suggestRunOptimizations(run)
    expect(suggestions.some((s) => s.kind === "parallel")).toBe(true)
  })

  it("suggests checkpoints for long runs without any", () => {
    const events = Array.from({ length: 60 }, (_, i) =>
      event({ id: `e${i}`, seq: i + 1, lane: `lane${i % 3}` }),
    )
    const run = makeRun({ events })
    const suggestions = suggestRunOptimizations(run)
    expect(suggestions.some((s) => s.kind === "checkpoint")).toBe(true)
  })
})
