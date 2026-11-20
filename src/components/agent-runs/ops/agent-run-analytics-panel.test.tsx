import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { AgentRunAnalyticsPanel } from "./agent-run-analytics-panel"
import { buildOpsRun } from "@/lib/agent-runs/ops/fixtures"
import type { AgentRunRecord } from "@/lib/agent-runs/ops/types"

const NOW = new Date("2026-11-19T12:00:00.000Z").getTime()

function run(partial: Partial<AgentRunRecord>): AgentRunRecord {
  return buildOpsRun(partial)
}

describe("AgentRunAnalyticsPanel", () => {
  it("shows empty state with no runs", () => {
    render(<AgentRunAnalyticsPanel runs={[]} now={NOW} />)
    expect(screen.getByText(/No runs to analyze/)).toBeInTheDocument()
  })

  it("renders aggregated metrics", () => {
    const runs = [
      run({
        id: "r1",
        status: "succeeded",
        model: "m-a",
        metrics: { model: "m-a", costUsd: 0.01, totalTokens: 100 },
      }),
      run({
        id: "r2",
        status: "failed",
        model: "m-b",
        metrics: { model: "m-b", costUsd: 0.02, totalTokens: 200 },
      }),
      run({
        id: "r3",
        status: "succeeded",
        model: "m-a",
        metrics: { model: "m-a", costUsd: 0.01, totalTokens: 100 },
      }),
    ]
    render(<AgentRunAnalyticsPanel runs={runs} now={NOW} />)
    expect(screen.getByText(/3 runs · latest/)).toBeInTheDocument()
    expect(screen.getByText("67%")).toBeInTheDocument() // 2/3 success
    expect(screen.getByText("$0.04")).toBeInTheDocument()
    expect(screen.getByText("succeeded")).toBeInTheDocument()
    expect(screen.getByText("m-a")).toBeInTheDocument()
    expect(screen.getByText("m-b")).toBeInTheDocument()
  })
})
