import { describe, expect, it } from "vitest"

import { appendBranchEvent, createBranch } from "./branching"
import {
  detectMergeConflicts,
  divergentEvents,
  exportMergedRun,
  exportRun,
  mergeRuns,
} from "./merge"
import { makeEvent, makeRun } from "./fixtures"
import type { AgentRunEvent } from "./types"

function event(overrides: Partial<AgentRunEvent> = {}): AgentRunEvent {
  return makeEvent(overrides)
}

/** Build a base run plus two branches forked at seq 2 with divergent tails. */
function scenario() {
  const base = makeRun({
    id: "base",
    status: "completed",
    events: [
      event({ id: "b1", seq: 1, name: "shared.one" }),
      event({ id: "b2", seq: 2, name: "shared.two" }),
    ],
  })

  const ours = createBranch(base, { atSeq: 2, label: "ours", id: "br_ours" })
  const oursWithEvents = appendBranchEvent(ours, {
    id: "o1",
    timestamp: "2026-11-19T12:05:00.000Z",
    type: "step",
    name: "deploy",
    summary: "deploy v1",
    payload: { version: 1 },
  })

  const theirs = createBranch(base, { atSeq: 2, label: "theirs", id: "br_theirs" })
  const theirsWithEvents = appendBranchEvent(theirs, {
    id: "t1",
    timestamp: "2026-11-19T12:06:00.000Z",
    type: "step",
    name: "tests",
    summary: "run tests",
  })

  return { base, ours: oursWithEvents, theirs: theirsWithEvents }
}

describe("divergentEvents", () => {
  it("returns post-fork events for branches", () => {
    const { ours } = scenario()
    const div = divergentEvents(ours)
    expect(div).toHaveLength(1)
    expect(div[0].name).toBe("deploy")
  })
})

describe("detectMergeConflicts", () => {
  it("flags same-name different-content events", () => {
    const a = event({ id: "a1", seq: 3, name: "deploy", payload: { v: 1 } })
    const b = event({ id: "b1", seq: 3, name: "deploy", payload: { v: 2 } })
    const conflicts = detectMergeConflicts([a], [b])
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].key).toBe("deploy")
    expect(conflicts[0].ours.id).toBe("a1")
    expect(conflicts[0].theirs.id).toBe("b1")
  })

  it("treats identical events as duplicates, not conflicts", () => {
    const a = event({ id: "a1", seq: 3, name: "deploy", payload: { v: 1 } })
    const b = event({ id: "b1", seq: 3, name: "deploy", payload: { v: 1 } })
    expect(detectMergeConflicts([a], [b])).toHaveLength(0)
  })

  it("ignores events with different names", () => {
    const a = event({ id: "a1", seq: 3, name: "deploy" })
    const b = event({ id: "b1", seq: 3, name: "tests" })
    expect(detectMergeConflicts([a], [b])).toHaveLength(0)
  })
})

describe("mergeRuns", () => {
  it("union strategy combines non-conflicting divergent events", () => {
    const { base, ours, theirs } = scenario()
    const result = mergeRuns(base, ours, theirs, { strategy: "union" })
    const names = result.run.events.map((e) => e.name)
    expect(names).toEqual(["shared.one", "shared.two", "deploy", "tests"])
    expect(result.conflicts).toHaveLength(0)
    expect(result.run.mergedFrom).toEqual([ours.id, theirs.id])
    // Seq renumbered sequentially.
    expect(result.run.events.map((e) => e.seq)).toEqual([1, 2, 3, 4])
  })

  it("ours/theirs strategies keep only that side's divergence", () => {
    const { base, ours, theirs } = scenario()
    const oursResult = mergeRuns(base, ours, theirs, { strategy: "ours" })
    expect(oursResult.run.events.map((e) => e.name)).toEqual(["shared.one", "shared.two", "deploy"])
    const theirsResult = mergeRuns(base, ours, theirs, { strategy: "theirs" })
    expect(theirsResult.run.events.map((e) => e.name)).toEqual([
      "shared.one",
      "shared.two",
      "tests",
    ])
  })

  it("detects conflicts when both branches changed the same step", () => {
    const base = makeRun({
      id: "base2",
      events: [event({ id: "b1", seq: 1, name: "shared" })],
    })
    const ours = appendBranchEvent(createBranch(base, { atSeq: 1 }), {
      id: "o1",
      timestamp: "2026-11-19T12:05:00.000Z",
      type: "step",
      name: "deploy",
      payload: { version: 1 },
    })
    const theirs = appendBranchEvent(createBranch(base, { atSeq: 1 }), {
      id: "t1",
      timestamp: "2026-11-19T12:06:00.000Z",
      type: "step",
      name: "deploy",
      payload: { version: 2 },
    })

    const result = mergeRuns(base, ours, theirs, { strategy: "union" })
    expect(result.conflicts).toHaveLength(1)
    // Default resolution is ours.
    const deploys = result.run.events.filter((e) => e.name === "deploy")
    expect(deploys).toHaveLength(1)
    expect(deploys[0].payload?.version).toBe(1)
  })

  it("resolve callback can pick theirs or both", () => {
    const base = makeRun({
      id: "base3",
      events: [event({ id: "b1", seq: 1, name: "shared" })],
    })
    const mk = (id: string, v: number) =>
      appendBranchEvent(createBranch(base, { atSeq: 1 }), {
        id,
        timestamp: "2026-11-19T12:05:00.000Z",
        type: "step",
        name: "deploy",
        payload: { version: v },
      })
    const theirsResult = mergeRuns(base, mk("o1", 1), mk("t1", 2), {
      strategy: "union",
      resolve: () => "theirs",
    })
    expect(theirsResult.run.events.find((e) => e.name === "deploy")?.payload?.version).toBe(2)

    const bothResult = mergeRuns(base, mk("o2", 1), mk("t2", 2), {
      strategy: "union",
      resolve: () => "both",
    })
    // "both" keeps both events but dedupe may collapse identical names? They
    // differ in payload so both survive.
    expect(bothResult.run.events.filter((e) => e.name === "deploy")).toHaveLength(2)
  })

  it("dedupes identical divergent events in union merges", () => {
    const base = makeRun({
      id: "base4",
      events: [event({ id: "b1", seq: 1, name: "shared" })],
    })
    const shared = {
      timestamp: "2026-11-19T12:05:00.000Z",
      type: "step" as const,
      name: "deploy",
      payload: { version: 1 },
    }
    const ours = appendBranchEvent(createBranch(base, { atSeq: 1 }), { ...shared, id: "o1" })
    const theirs = appendBranchEvent(createBranch(base, { atSeq: 1 }), { ...shared, id: "t1" })
    const result = mergeRuns(base, ours, theirs, { strategy: "union" })
    expect(result.run.events.filter((e) => e.name === "deploy")).toHaveLength(1)
    expect(result.conflicts).toHaveLength(0)
  })

  it("copies the checkpoints array (no shared reference with base)", () => {
    const base = makeRun({
      id: "base_cp",
      checkpoints: [{ id: "cp1", seq: 1, timestamp: "2026-11-19T12:00:00.000Z", eventCount: 1 }],
      events: [event({ id: "b1", seq: 1, name: "shared" })],
    })
    const ours = appendBranchEvent(createBranch(base, { atSeq: 1 }), {
      id: "o1",
      timestamp: "2026-11-19T12:05:00.000Z",
      type: "step",
      name: "deploy",
    })
    const theirs = createBranch(base, { atSeq: 1 })
    const result = mergeRuns(base, ours, theirs)
    expect(result.run.checkpoints).toEqual(base.checkpoints)
    expect(result.run.checkpoints).not.toBe(base.checkpoints)
    // Mutating the merged run's checkpoints must not leak into the base.
    result.run.checkpoints.push({
      id: "cp2",
      seq: 2,
      timestamp: "2026-11-19T12:06:00.000Z",
      eventCount: 2,
    })
    expect(base.checkpoints).toHaveLength(1)
  })

  it("recomputes metrics and marks mergedFrom", () => {
    const { base, ours, theirs } = scenario()
    const result = mergeRuns(base, ours, theirs)
    expect(result.run.metrics.steps).toBe(4)
    expect(result.run.mergedFrom).toEqual([ours.id, theirs.id])
  })
})

describe("export", () => {
  it("exportMergedRun serializes run + conflict summary", () => {
    const { base, ours, theirs } = scenario()
    const result = mergeRuns(base, ours, theirs)
    const json = exportMergedRun(result)
    const parsed = JSON.parse(json)
    expect(parsed.run.id).toBe(result.run.id)
    expect(parsed.conflicts).toEqual([])
    expect(parsed.exportedAt).toBeDefined()
  })

  it("exportRun serializes a bare run", () => {
    const run = makeRun()
    expect(JSON.parse(exportRun(run)).id).toBe(run.id)
    expect(exportRun(run, false)).not.toContain("\n")
  })
})
