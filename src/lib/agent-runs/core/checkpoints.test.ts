import { describe, expect, it } from "vitest"

import {
  addCheckpoint,
  autoCheckpoints,
  checkpointEvents,
  checkpointRun,
  createCheckpoint,
  eventsAfterSeq,
  eventsUpToSeq,
  findCheckpoint,
  listCheckpoints,
  nameCheckpoint,
} from "./checkpoints"
import { makeEvent, makeRun } from "./fixtures"
import type { AgentRunEvent } from "./types"

function event(overrides: Partial<AgentRunEvent> = {}): AgentRunEvent {
  return makeEvent(overrides)
}

describe("createCheckpoint / addCheckpoint", () => {
  it("snapshots the run at its current end", () => {
    const run = makeRun({
      events: [event({ id: "a", seq: 1 }), event({ id: "b", seq: 2 }), event({ id: "c", seq: 3 })],
    })
    const cp = createCheckpoint(run, { name: "mid" })
    expect(cp.seq).toBe(3)
    expect(cp.eventCount).toBe(3)
    expect(cp.name).toBe("mid")
    expect(cp.metrics).toBeDefined()
  })

  it("snapshots at an explicit seq", () => {
    const run = makeRun({
      events: [event({ id: "a", seq: 1 }), event({ id: "b", seq: 5 }), event({ id: "c", seq: 9 })],
    })
    const cp = createCheckpoint(run, { seq: 5 })
    expect(cp.seq).toBe(5)
    expect(cp.eventCount).toBe(2)
  })

  it("addCheckpoint returns a new run with the checkpoint appended", () => {
    const run = makeRun()
    const cp = createCheckpoint(run)
    const next = addCheckpoint(run, cp)
    expect(next.checkpoints).toHaveLength(1)
    expect(run.checkpoints).toHaveLength(0)
  })

  it("checkpointRun does both in one call", () => {
    const run = makeRun()
    const next = checkpointRun(run, { name: "start" })
    expect(next.checkpoints).toHaveLength(1)
    expect(next.checkpoints[0].name).toBe("start")
  })
})

describe("listCheckpoints / findCheckpoint / nameCheckpoint", () => {
  it("sorts by seq and finds by id", () => {
    const run = makeRun({
      events: [event({ id: "a", seq: 1 }), event({ id: "b", seq: 2 }), event({ id: "c", seq: 3 })],
    })
    const late = createCheckpoint(run, { seq: 3 })
    const early = createCheckpoint(run, { seq: 1 })
    const withCps = { ...run, checkpoints: [late, early] }
    expect(listCheckpoints(withCps).map((c) => c.seq)).toEqual([1, 3])
    expect(findCheckpoint(withCps, early.id)?.seq).toBe(1)
    expect(findCheckpoint(withCps, "nope")).toBeNull()
  })

  it("nameCheckpoint renames immutably", () => {
    const run = makeRun()
    const cp = createCheckpoint(run)
    const withCp = addCheckpoint(run, cp)
    const named = nameCheckpoint(withCp, cp.id, "before deploy")
    expect(named.checkpoints[0].name).toBe("before deploy")
    expect(withCp.checkpoints[0].name).toBeUndefined()
  })
})

describe("autoCheckpoints", () => {
  it("emits a checkpoint every N events", () => {
    const run = makeRun({
      events: Array.from({ length: 7 }, (_, i) => event({ id: `e${i}`, seq: i + 1 })),
    })
    const cps = autoCheckpoints(run, { everyEvents: 3 })
    expect(cps.map((c) => c.seq)).toEqual([3, 6])
    expect(cps[0].name).toContain("event 3")
  })

  it("emits checkpoints on time boundaries", () => {
    const base = Date.parse("2026-11-19T12:00:00.000Z")
    const run = makeRun({
      events: [0, 30, 70, 130].map((offset, i) =>
        event({ id: `e${i}`, seq: i + 1, timestamp: new Date(base + offset * 1000).toISOString() }),
      ),
    })
    const cps = autoCheckpoints(run, { everyMs: 60_000 })
    // Boundaries at +60s and +120s → events at 70s (seq 3) and 130s (seq 4).
    expect(cps.length).toBeGreaterThanOrEqual(1)
    expect(cps[0].seq).toBe(3)
  })

  it("emits one checkpoint per interval crossed by a single event", () => {
    const base = Date.parse("2026-11-19T12:00:00.000Z")
    const run = makeRun({
      events: [
        event({ id: "e0", seq: 1, timestamp: new Date(base).toISOString() }),
        // Jumps 5 minutes ahead — crosses five 60s boundaries at once.
        event({ id: "e1", seq: 2, timestamp: new Date(base + 300_000).toISOString() }),
      ],
    })
    const cps = autoCheckpoints(run, { everyMs: 60_000 })
    expect(cps).toHaveLength(5)
    // All anchored to the crossing event's seq since intermediates weren't recorded.
    expect(cps.every((c) => c.seq === 2)).toBe(true)
    const names = cps.map((c) => c.name)
    expect(new Set(names).size).toBe(5)
  })

  it("returns empty for empty runs", () => {
    expect(autoCheckpoints(makeRun({ events: [] }), { everyEvents: 2 })).toHaveLength(0)
  })
})

describe("seq helpers", () => {
  it("eventsUpToSeq / eventsAfterSeq partition the log", () => {
    const events = [
      event({ id: "a", seq: 1 }),
      event({ id: "b", seq: 2 }),
      event({ id: "c", seq: 3 }),
    ]
    expect(eventsUpToSeq(events, 2).map((e) => e.id)).toEqual(["a", "b"])
    expect(eventsAfterSeq(events, 2).map((e) => e.id)).toEqual(["c"])
  })

  it("checkpointEvents returns the snapshot slice", () => {
    const run = makeRun({
      events: [event({ id: "a", seq: 1 }), event({ id: "b", seq: 2 }), event({ id: "c", seq: 3 })],
    })
    const cp = createCheckpoint(run, { seq: 2 })
    expect(checkpointEvents(run, cp).map((e) => e.id)).toEqual(["a", "b"])
  })
})
