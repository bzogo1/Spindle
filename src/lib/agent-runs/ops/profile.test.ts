import { describe, expect, it } from "vitest"

import { buildRunProfile, detectBottlenecks, flameBarRows } from "./profile"
import { buildOpsRun, buildOpsStep } from "./fixtures"
import type { AgentRunRecord } from "./types"

function runWithSteps(steps: AgentRunRecord["steps"]): AgentRunRecord {
  return buildOpsRun({ steps })
}

describe("buildRunProfile", () => {
  it("produces offsets relative to run start", () => {
    const run = runWithSteps([
      buildOpsStep({
        id: "a",
        startedAt: "2026-11-19T09:30:01.000Z",
        durationMs: 1000,
      }),
      buildOpsStep({
        id: "b",
        kind: "tool_call",
        title: "Slow tool",
        startedAt: "2026-11-19T09:30:05.000Z",
        durationMs: 4000,
      }),
    ])
    const profile = buildRunProfile(run)
    expect(profile.totalMs).toBe(239_000) // fixture finishedAt delta
    const [a, b] = profile.steps
    expect(a.startOffsetMs).toBe(0)
    expect(a.endOffsetMs).toBe(1000)
    expect(b.startOffsetMs).toBe(4000)
    expect(b.durationMs).toBe(4000)
    expect(profile.byKind.tool_call).toBe(4000)
  })

  it("skips steps with unparseable timestamps", () => {
    const run = runWithSteps([
      buildOpsStep({ id: "ok", durationMs: 100 }),
      buildOpsStep({ id: "bad", startedAt: "garbage", durationMs: 100 }),
    ])
    const profile = buildRunProfile(run)
    expect(profile.steps).toHaveLength(1)
    expect(profile.skippedSteps).toBe(1)
  })
})

describe("detectBottlenecks", () => {
  it("flags steps over share and duration thresholds", () => {
    // total = fixture window (~239s); a 120s step is ~50% share.
    const run = runWithSteps([
      buildOpsStep({
        id: "slow",
        kind: "tool_call",
        title: "Heavy tool",
        startedAt: "2026-11-19T09:30:01.000Z",
        durationMs: 120_000,
      }),
      buildOpsStep({
        id: "fast",
        title: "Quick step",
        startedAt: "2026-11-19T09:30:41.000Z",
        durationMs: 500,
      }),
    ])
    const profile = buildRunProfile(run)
    const bottlenecks = detectBottlenecks(profile)
    expect(bottlenecks).toHaveLength(1)
    expect(bottlenecks[0].step.stepId).toBe("slow")
    expect(bottlenecks[0].share).toBeCloseTo(120_000 / profile.totalMs)
    expect(bottlenecks[0].reason).toContain("Tool call")
  })

  it("respects custom thresholds and limit", () => {
    const run = runWithSteps([
      buildOpsStep({ id: "s1", durationMs: 20_000, startedAt: "2026-11-19T09:30:01.000Z" }),
      buildOpsStep({ id: "s2", durationMs: 10_000, startedAt: "2026-11-19T09:30:21.000Z" }),
    ])
    const profile = buildRunProfile(run)
    // With a 90% share threshold nothing qualifies.
    expect(detectBottlenecks(profile, { shareThreshold: 0.9 })).toEqual([])
    const all = detectBottlenecks(profile, { shareThreshold: 0.05, limit: 1 })
    expect(all).toHaveLength(1)
    expect(all[0].step.stepId).toBe("s1")
  })

  it("returns empty for zero-duration profiles", () => {
    const profile = buildRunProfile(buildOpsRun({ steps: [] }))
    // Fixture has finishedAt so totalMs > 0; force empty profile instead.
    const empty = { ...profile, totalMs: 0, steps: [] }
    expect(detectBottlenecks(empty)).toEqual([])
    expect(flameBarRows(empty)).toEqual([])
  })
})

describe("flameBarRows", () => {
  it("positions bars as percentages of the total window", () => {
    const run = runWithSteps([
      buildOpsStep({ id: "a", startedAt: "2026-11-19T09:30:01.000Z", durationMs: 30_000 }),
      buildOpsStep({
        id: "b",
        kind: "tool_call",
        title: "T",
        startedAt: "2026-11-19T09:30:31.000Z",
        durationMs: 30_000,
      }),
    ])
    const profile = buildRunProfile(run)
    const rows = flameBarRows(profile)
    expect(rows).toHaveLength(2)
    expect(rows[0].step.stepId).toBe("a")
    expect(rows[0].leftPct).toBeCloseTo(0)
    expect(rows[0].widthPct).toBeCloseTo((30_000 / profile.totalMs) * 100)
    expect(rows[1].leftPct).toBeCloseTo((30_000 / profile.totalMs) * 100)
  })

  it("clamps out-of-window steps to [0, 100]", () => {
    const run = runWithSteps([
      buildOpsStep({
        id: "overrun",
        startedAt: "2026-11-19T09:30:01.000Z",
        // Step ends far beyond finishedAt — raw width would exceed the track.
        durationMs: 10 * 60 * 1000,
      }),
      buildOpsStep({
        id: "late",
        kind: "tool_call",
        title: "Late",
        startedAt: "2026-11-19T09:40:00.000Z", // after finishedAt (09:34)
        durationMs: 1000,
      }),
    ])
    const profile = buildRunProfile(run)
    const rows = flameBarRows(profile)
    for (const row of rows) {
      expect(row.leftPct).toBeGreaterThanOrEqual(0)
      expect(row.leftPct).toBeLessThanOrEqual(100)
      expect(row.widthPct).toBeGreaterThanOrEqual(0)
      expect(row.widthPct).toBeLessThanOrEqual(100)
      expect(row.leftPct + row.widthPct).toBeLessThanOrEqual(100.001)
    }
    const late = rows.find((r) => r.step.stepId === "late")
    expect(late?.leftPct).toBe(100)
    expect(late?.widthPct).toBe(0)
  })
})
