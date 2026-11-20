import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { AgentRunOptimizationPanel } from "./agent-run-optimization-panel"
import { buildOpsRun, buildOpsStep } from "@/lib/agent-runs/ops/fixtures"

describe("AgentRunOptimizationPanel", () => {
  it("shows clean state for an efficient run", () => {
    render(<AgentRunOptimizationPanel run={buildOpsRun()} />)
    expect(screen.getByText(/No waste patterns/)).toBeInTheDocument()
  })

  it("lists findings with severity and hints", () => {
    const run = buildOpsRun({
      steps: [
        buildOpsStep({
          id: "a",
          title: "Fetch",
          kind: "tool_call",
          status: "failed",
          durationMs: 2000,
        }),
        buildOpsStep({
          id: "b",
          title: "Fetch",
          kind: "tool_call",
          status: "done",
          durationMs: 1000,
        }),
      ],
    })
    render(<AgentRunOptimizationPanel run={run} />)
    expect(screen.getByText("Retry waste on “Fetch”")).toBeInTheDocument()
    expect(screen.getByText(/backoff \+ jitter/)).toBeInTheDocument()
    expect(screen.getByText(/Repeated step/)).toBeInTheDocument()
    expect(screen.getByText(/Payload footprint/)).toBeInTheDocument()
  })
})
