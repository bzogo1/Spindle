import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { checkpointRun } from "@/lib/agent-runs/core"
import { makeEvent, makeRun } from "@/lib/agent-runs/core/fixtures"

import { CheckpointTimeline } from "./checkpoint-timeline"

function runWithCheckpoints() {
  const base = makeRun({
    status: "running",
    events: [
      makeEvent({ id: "a", seq: 1, name: "one" }),
      makeEvent({ id: "b", seq: 2, name: "two" }),
      makeEvent({ id: "c", seq: 3, name: "three" }),
    ],
  })
  return checkpointRun(checkpointRun(base, { name: "start", seq: 1 }), {
    name: "halfway",
    seq: 2,
  })
}

describe("CheckpointTimeline", () => {
  it("renders checkpoints in seq order with names", () => {
    render(<CheckpointTimeline run={runWithCheckpoints()} />)
    expect(screen.getByText("start")).toBeInTheDocument()
    expect(screen.getByText("halfway")).toBeInTheDocument()
    expect(screen.getByTestId("checkpoint-timeline")).toBeInTheDocument()
  })

  it("shows empty state when no checkpoints exist", () => {
    render(<CheckpointTimeline run={makeRun()} />)
    expect(screen.getByText(/No checkpoints recorded/)).toBeInTheDocument()
  })

  it("marks the current position and disables its restore button", () => {
    const run = runWithCheckpoints()
    render(<CheckpointTimeline run={run} currentSeq={2} onRollback={vi.fn()} />)
    const halfway = screen.getByTestId(`checkpoint-${run.checkpoints[1].id}`)
    expect(halfway).toHaveTextContent("current")
    expect(screen.getByRole("button", { name: /Restore checkpoint halfway/ })).toBeDisabled()
  })

  it("calls onRollback with the checkpoint", async () => {
    const user = userEvent.setup()
    const onRollback = vi.fn()
    const run = runWithCheckpoints()
    render(<CheckpointTimeline run={run} currentSeq={3} onRollback={onRollback} />)
    await user.click(screen.getByRole("button", { name: /Restore checkpoint start/ }))
    expect(onRollback).toHaveBeenCalledWith(run.checkpoints[0])
  })

  it("hides restore buttons without onRollback", () => {
    render(<CheckpointTimeline run={runWithCheckpoints()} />)
    expect(screen.queryByRole("button", { name: /Restore/ })).not.toBeInTheDocument()
  })

  it("shows rolled-back badge and truncation note", async () => {
    const { rollbackRun } = await import("@/lib/agent-runs/core")
    const run = rollbackRun(runWithCheckpoints(), { atSeq: 1 }).run
    render(<CheckpointTimeline run={run} />)
    expect(screen.getByTestId("rolled-back-badge")).toBeInTheDocument()
    expect(screen.getByTestId("rollback-note")).toHaveTextContent("truncated")
  })
})
