import { describe, expect, it } from "vitest"

import {
  mergeBranchResults,
  orderParallelResults,
  planRunBranches,
  runParallelMock,
  runSimulationSeed,
  simulateRunBranches,
  type ParallelTask,
} from "./parallel"
import { makeEvent, makeRun } from "./fixtures"
import type { AgentRunEvent } from "./types"

function event(overrides: Partial<AgentRunEvent> = {}): AgentRunEvent {
  return makeEvent(overrides)
}

describe("planRunBranches", () => {
  it("groups events by explicit lane", () => {
    const run = makeRun({
      events: [
        event({ id: "a", seq: 1, name: "x", lane: "research" }),
        event({ id: "b", seq: 2, name: "y", lane: "write" }),
        event({ id: "c", seq: 3, name: "z", lane: "research" }),
      ],
    })
    const plans = planRunBranches(run)
    expect(plans).toHaveLength(2)
    expect(plans.find((p) => p.lane === "research")?.events).toHaveLength(2)
    expect(plans.find((p) => p.lane === "write")?.events).toHaveLength(1)
  })

  it("falls back to payload.branch then name prefix", () => {
    const run = makeRun({
      events: [
        event({ id: "a", seq: 1, name: "anything", payload: { branch: "alpha" } }),
        event({ id: "b", seq: 2, name: "beta.step" }),
        event({ id: "c", seq: 3, name: "beta.other" }),
      ],
    })
    const plans = planRunBranches(run)
    expect(plans.map((p) => p.lane).sort()).toEqual(["alpha", "beta"])
  })

  it("folds lanes past maxBranches into a catch-all instead of dropping them", () => {
    const run = makeRun({
      events: Array.from({ length: 10 }, (_, i) =>
        event({ id: `e${i}`, seq: i + 1, lane: `lane${i}` }),
      ),
    })
    const plans = planRunBranches(run, { maxBranches: 3 })
    expect(plans).toHaveLength(3)
    const other = plans.find((p) => p.lane === "other")
    expect(other).toBeDefined()
    // 10 events across 10 lanes, cap 3 → 2 named lanes + "other" with 8.
    expect(other!.events).toHaveLength(8)
    const total = plans.reduce((sum, p) => sum + p.events.length, 0)
    expect(total).toBe(10)
    // "other" preserves original event order.
    expect(other!.events.map((e) => e.id)).toEqual(["e2", "e3", "e4", "e5", "e6", "e7", "e8", "e9"])
  })

  it("maxBranches=1 produces a single catch-all lane", () => {
    const run = makeRun({
      events: [event({ id: "a", seq: 1, lane: "x" }), event({ id: "b", seq: 2, lane: "y" })],
    })
    const plans = planRunBranches(run, { maxBranches: 1 })
    expect(plans).toHaveLength(1)
    expect(plans[0].lane).toBe("other")
    expect(plans[0].events).toHaveLength(2)
  })
})

describe("runParallelMock", () => {
  it("executes tasks and returns results", async () => {
    const tasks: ParallelTask<number>[] = [1, 2, 3].map((n) => ({
      id: `t${n}`,
      run: async () => n * 10,
    }))
    const results = await runParallelMock(tasks)
    expect(results).toHaveLength(3)
    expect(results.map((r) => r.result)).toEqual([10, 20, 30])
  })

  it("enforces the concurrency limit", async () => {
    let inFlight = 0
    let maxInFlight = 0
    const tasks: ParallelTask<void>[] = Array.from({ length: 6 }, (_, i) => ({
      id: `t${i}`,
      run: async () => {
        inFlight += 1
        maxInFlight = Math.max(maxInFlight, inFlight)
        await new Promise((r) => setTimeout(r, 5))
        inFlight -= 1
      },
    }))
    await runParallelMock(tasks, { concurrency: 2 })
    expect(maxInFlight).toBeLessThanOrEqual(2)
    expect(maxInFlight).toBe(2)
  })

  it("captures task errors without rejecting the batch", async () => {
    const tasks: ParallelTask<string>[] = [
      { id: "ok", run: () => "fine" },
      {
        id: "bad",
        run: () => {
          throw new Error("boom")
        },
      },
    ]
    const results = await runParallelMock(tasks)
    const bad = results.find((r) => r.id === "bad")
    expect(bad?.error).toBe("boom")
    expect(results.find((r) => r.id === "ok")?.result).toBe("fine")
  })

  it("orderParallelResults restores submission order", async () => {
    const tasks: ParallelTask<number>[] = [30, 10, 20].map((ms, i) => ({
      id: `t${i}`,
      run: () => new Promise<number>((r) => setTimeout(() => r(ms), ms)),
    }))
    const results = orderParallelResults(await runParallelMock(tasks))
    expect(results.map((r) => r.index)).toEqual([0, 1, 2])
  })
})

describe("simulateRunBranches", () => {
  it("splits a run into lanes and merges results in order", async () => {
    const run = makeRun({
      status: "running",
      events: [
        event({ id: "a", seq: 1, name: "plan", lane: "main" }),
        event({ id: "b", seq: 2, name: "research.fetch", lane: "research" }),
        event({ id: "c", seq: 3, name: "write.draft", lane: "write" }),
        event({ id: "d", seq: 4, name: "review", lane: "main" }),
      ],
    })
    const { run: merged, branches } = await simulateRunBranches(run)
    expect(branches.length).toBeGreaterThanOrEqual(2)
    expect(merged.status).toBe("completed")
    // Original events preserved, simulated events appended with sequential seqs.
    const originalCount = run.events.length
    expect(merged.events.length).toBe(
      originalCount + branches.reduce((s, b) => s + b.events.length, 0),
    )
    const seqs = merged.events.map((e) => e.seq)
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b))
    expect(new Set(seqs).size).toBe(seqs.length)
  })

  it("mergeBranchResults preserves branch plan ordering", async () => {
    const run = makeRun({
      events: [event({ id: "a", seq: 1, lane: "zeta" }), event({ id: "b", seq: 2, lane: "alpha" })],
    })
    const plans = planRunBranches(run)
    const tasks = plans.map((plan) => ({
      id: plan.id,
      run: async () => ({
        plan,
        events: plan.events.map((e) => ({ ...e, id: `${e.id}_sim` })),
        metrics: {},
        durationMs: 1,
      }),
    }))
    const results = await runParallelMock(tasks)
    const merged = mergeBranchResults(run, orderParallelResults(results))
    // alpha branch events appear before zeta's in merged output order.
    const simIds = merged.events.slice(run.events.length).map((e) => e.id)
    expect(simIds[0]).toContain("_sim")
  })

  it("mergeBranchResults continues seqs from the last event, not the count", async () => {
    // Non-contiguous seqs (e.g. after a rollback) must not collide.
    const run = makeRun({
      events: [event({ id: "a", seq: 10, lane: "x" }), event({ id: "b", seq: 20, lane: "y" })],
    })
    const plans = planRunBranches(run)
    const tasks = plans.map((plan) => ({
      id: plan.id,
      run: async () => ({
        plan,
        events: plan.events.map((e) => ({ ...e, id: `${e.id}_sim` })),
        metrics: {},
        durationMs: 1,
      }),
    }))
    const results = await runParallelMock(tasks)
    const merged = mergeBranchResults(run, orderParallelResults(results))
    const appended = merged.events.slice(run.events.length)
    expect(appended.map((e) => e.seq)).toEqual([21, 22])
  })
})

describe("runSimulationSeed", () => {
  it("is deterministic per run", () => {
    const run = makeRun()
    expect(runSimulationSeed(run)).toBe(runSimulationSeed(run))
    expect(runSimulationSeed(run)).not.toBe(runSimulationSeed(makeRun({ id: "run_2" })))
  })
})
