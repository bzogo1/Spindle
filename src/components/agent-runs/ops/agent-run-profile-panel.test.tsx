import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { AgentRunProfilePanel } from "./agent-run-profile-panel"
import { buildOpsRun, buildOpsStep } from "@/lib/agent-runs/ops/fixtures"

describe("AgentRunProfilePanel", () => {
  it("renders flame bars and the timing table", () => {
    render(<AgentRunProfilePanel run={buildOpsRun()} />)
    expect(screen.getByText(/3 profiled steps/)).toBeInTheDocument()
    expect(screen.getByRole("img", { name: /flame bar/i })).toBeInTheDocument()
    expect(screen.getByText("Planned the draft")).toBeInTheDocument()
    expect(screen.getByText("Write docs/methods.md")).toBeInTheDocument()
  })

  it("detects and lists bottlenecks", () => {
    const run = buildOpsRun({
      steps: [
        buildOpsStep({
          id: "slow",
          kind: "tool_call",
          title: "Heavy tool",
          startedAt: "2026-11-19T09:30:01.000Z",
          durationMs: 150_000,
        }),
      ],
    })
    render(<AgentRunProfilePanel run={run} />)
    expect(screen.getByText("Bottlenecks")).toBeInTheDocument()
    // Title appears in both the timing table and the bottleneck list.
    expect(screen.getAllByText("Heavy tool").length).toBeGreaterThan(0)
    expect(screen.getByText(/% of run/)).toBeInTheDocument()
  })

  it("shows empty state without timed steps", () => {
    render(
      <AgentRunProfilePanel
        run={buildOpsRun({
          steps: [buildOpsStep({ startedAt: "bad", durationMs: undefined, endedAt: undefined })],
        })}
      />,
    )
    expect(screen.getByText(/No timed steps/)).toBeInTheDocument()
    expect(screen.getByText(/1 skipped/)).toBeInTheDocument()
  })
})
