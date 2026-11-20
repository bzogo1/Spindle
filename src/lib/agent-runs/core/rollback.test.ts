import { describe, expect, it } from "vitest"

import { checkpointRun } from "./checkpoints"
import { makeEvent, makeRun } from "./fixtures"
import { isRolledBack, rollbackMarker, rollbackRun, RollbackError } from "./rollback"
import type { AgentRunEvent } from "./types"

function event(overrides: Partial<AgentRunEvent> = {}): AgentRunEvent {
  return makeEvent(overrides)
}

function runWithEvents(count = 5) {
  return makeRun({
    status: "completed",
    events: Array.from({ length: count }, (_, i) =>
      event({ id: `e${i + 1}`, seq: i + 1, name: `step.${i}` }),
    ),
  })
}

describe("rollbackRun", () => {
  it("truncates events after the checkpoint and appends a marker", () => {
    const run = checkpointRun(runWithEvents(5), { name: "halfway", seq: 3 })
    const cp = run.checkpoints[0]
    const result = rollbackRun(run, { checkpointId: cp.id })

    expect(result.truncatedEvents).toBe(2) // seq 4,5 dropped; marker added
    expect(result.run.events.map((e) => e.seq)).toEqual([1, 2, 3, 4])
    const marker = result.run.events[result.run.events.length - 1]
    expect(marker.type).toBe("checkpoint")
    expect(marker.name).toBe("rollback")
    expect(marker.payload?.checkpointId).toBe(cp.id)
    expect(marker.payload?.truncatedEvents).toBe(2)
  })

  it("does not mutate the original run", () => {
    const run = checkpointRun(runWithEvents(5), { seq: 2 })
    const before = run.events.length
    rollbackRun(run, { checkpointId: run.checkpoints[0].id })
    expect(run.events).toHaveLength(before)
  })

  it("supports rollback by raw seq", () => {
    const run = runWithEvents(4)
    const result = rollbackRun(run, { atSeq: 2 })
    expect(result.run.events.filter((e) => e.type !== "checkpoint")).toHaveLength(2)
    expect(result.checkpoint.seq).toBe(2)
  })

  it("keeps prior checkpoints for timeline navigation", () => {
    const run = checkpointRun(runWithEvents(5), { seq: 2 })
    const result = rollbackRun(run, { checkpointId: run.checkpoints[0].id })
    expect(result.run.checkpoints).toHaveLength(1)
  })

  it("recomputes metrics from the truncated log", () => {
    const run = runWithEvents(5)
    const result = rollbackRun(run, { atSeq: 1 })
    expect(result.run.metrics.steps).toBe(1)
  })

  it("throws for unknown checkpoint or missing target", () => {
    const run = runWithEvents(3)
    expect(() => rollbackRun(run, { checkpointId: "nope" })).toThrow(RollbackError)
    expect(() => rollbackRun(run, {})).toThrow(RollbackError)
  })

  it("honors an explicit status override", () => {
    const run = runWithEvents(3)
    const result = rollbackRun(run, { atSeq: 1, status: "cancelled" })
    expect(result.run.status).toBe("cancelled")
  })

  it("preserves terminal status instead of forcing running", () => {
    for (const status of ["completed", "failed", "cancelled"] as const) {
      const run = makeRun({ ...runWithEvents(3), status })
      const result = rollbackRun(run, { atSeq: 1 })
      expect(result.run.status).toBe(status)
    }
  })

  it("re-derives running for active runs", () => {
    const run = makeRun({ ...runWithEvents(3), status: "running" as const })
    const result = rollbackRun(run, { atSeq: 1 })
    expect(result.run.status).toBe("running")
  })
})

describe("rollback markers", () => {
  it("isRolledBack / rollbackMarker detect the marker event", () => {
    const run = runWithEvents(3)
    expect(isRolledBack(run)).toBe(false)
    expect(rollbackMarker(run)).toBeNull()

    const rolled = rollbackRun(run, { atSeq: 1 }).run
    expect(isRolledBack(rolled)).toBe(true)
    expect(rollbackMarker(rolled)?.payload?.truncatedEvents).toBe(2)
  })
})
