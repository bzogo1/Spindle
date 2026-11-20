import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { makeEvent, makeRun } from "@/lib/agent-runs/core/fixtures"

import { RunCostSummary } from "./cost-summary"

describe("RunCostSummary", () => {
  it("renders cost, tokens, tier, and duration", () => {
    const run = makeRun({
      metrics: { durationMs: 12_345, totalTokens: 1500, costUsd: 0.05 },
    })
    render(<RunCostSummary run={run} />)
    expect(screen.getByTestId("cost-usd")).toHaveTextContent("$0.05")
    expect(screen.getByTestId("cost-tokens")).toHaveTextContent("1.5k")
    expect(screen.getByTestId("cost-duration")).toHaveTextContent("12.3s")
  })

  it("shows optimization suggestions", () => {
    const prompt = "x".repeat(5000)
    const run = makeRun({ prompt })
    const sibling = makeRun({ id: "run_2", prompt })
    render(<RunCostSummary run={run} allRuns={[sibling]} />)
    expect(screen.getByText("Repeated prompt detected")).toBeInTheDocument()
    expect(screen.getByText("Prompt is long")).toBeInTheDocument()
  })

  it("shows empty state when nothing to suggest", () => {
    const run = makeRun({
      prompt: "short",
      model: "gpt-4o-mini",
      checkpoints: [{ id: "c1", seq: 1, timestamp: "2026-11-19T12:00:00.000Z", eventCount: 1 }],
      events: [
        makeEvent({ id: "a", seq: 1, lane: "one" }),
        makeEvent({ id: "b", seq: 2, lane: "two" }),
      ],
    })
    render(<RunCostSummary run={run} />)
    expect(screen.getByText(/No optimization opportunities/)).toBeInTheDocument()
  })
})
