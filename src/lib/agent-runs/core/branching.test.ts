import { describe, expect, it } from "vitest"

import { appendBranchEvent, branchEvents, createBranch, isBranch, sharedPrefix } from "./branching"
import { makeEvent, makeRun } from "./fixtures"
import type { AgentRunEvent } from "./types"

function event(overrides: Partial<AgentRunEvent> = {}): AgentRunEvent {
  return makeEvent(overrides)
}

function parentRun() {
  return makeRun({
    status: "completed",
    events: Array.from({ length: 6 }, (_, i) =>
      event({ id: `e${i + 1}`, seq: i + 1, name: `step.${i}` }),
    ),
  })
}

describe("createBranch", () => {
  it("forks at an explicit seq keeping the prefix", () => {
    const parent = parentRun()
    const branch = createBranch(parent, { atSeq: 3, label: "alt path" })
    expect(isBranch(branch)).toBe(true)
    expect(branch.branch?.label).toBe("alt path")
    expect(branch.branch?.parentRunId).toBe(parent.id)
    expect(branch.branch?.forkedAtSeq).toBe(3)
    expect(branch.events.map((e) => e.seq)).toEqual([1, 2, 3])
    expect(branch.id).not.toBe(parent.id)
  })

  it("forks at a checkpoint", () => {
    const parent = makeRun({
      events: [event({ id: "a", seq: 1 }), event({ id: "b", seq: 2 }), event({ id: "c", seq: 3 })],
      checkpoints: [
        { id: "cp1", name: "early", seq: 1, timestamp: "2026-11-19T12:00:00.000Z", eventCount: 1 },
      ],
    })
    const branch = createBranch(parent, { checkpointId: "cp1" })
    expect(branch.events).toHaveLength(1)
    expect(branch.branch?.forkedAtSeq).toBe(1)
  })

  it("forks at an event id", () => {
    const parent = parentRun()
    const branch = createBranch(parent, { atEventId: "e4" })
    expect(branch.branch?.forkedAtSeq).toBe(4)
    expect(branch.branch?.forkedAtEventId).toBe("e4")
  })

  it("defaults to the end of the run", () => {
    const parent = parentRun()
    const branch = createBranch(parent)
    expect(branch.events).toHaveLength(6)
  })

  it("throws for unknown checkpoint/event", () => {
    const parent = parentRun()
    expect(() => createBranch(parent, { checkpointId: "nope" })).toThrow()
    expect(() => createBranch(parent, { atEventId: "nope" })).toThrow()
  })

  it("does not mutate the parent", () => {
    const parent = parentRun()
    const before = parent.events.length
    createBranch(parent, { atSeq: 2 })
    expect(parent.events).toHaveLength(before)
    expect(parent.branch).toBeUndefined()
  })
})

describe("appendBranchEvent / branchEvents / sharedPrefix", () => {
  it("appends divergent events stamped with the branch id", () => {
    const parent = parentRun()
    const branch = createBranch(parent, { atSeq: 3 })
    const next = appendEventForTest(branch)
    expect(next.events).toHaveLength(4)
    const last = next.events[next.events.length - 1]
    expect(last.seq).toBe(4)
    expect(last.branchId).toBe(branch.branch?.id)
  })

  it("branchEvents returns only the divergent tail", () => {
    const parent = parentRun()
    const branch = appendEventForTest(createBranch(parent, { atSeq: 3 }))
    const divergent = branchEvents(branch)
    expect(divergent).toHaveLength(1)
    expect(divergent[0].name).toBe("new.step")
    expect(sharedPrefix(branch)).toHaveLength(3)
  })
})

function appendEventForTest(branch: ReturnType<typeof createBranch>) {
  return appendBranchEvent(branch, {
    id: "new1",
    timestamp: "2026-11-19T12:10:00.000Z",
    type: "step",
    name: "new.step",
    summary: "divergent work",
  })
}
