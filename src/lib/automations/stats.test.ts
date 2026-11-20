import { describe, expect, it } from "vitest"

import { automationStats, workspaceAutomationStats, type AutomationRunStatsInput } from "./stats"

function run(overrides: Partial<AutomationRunStatsInput> = {}): AutomationRunStatsInput {
  return {
    status: "succeeded",
    startedAt: "2026-11-19T09:00:00.000Z",
    durationMs: 10_000,
    ...overrides,
  }
}

describe("automationStats", () => {
  it("returns null rates and averages for an empty run list", () => {
    const stats = automationStats([])
    expect(stats.runCount).toBe(0)
    expect(stats.successRate).toBeNull()
    expect(stats.avgDurationMs).toBeNull()
    expect(stats.lastRunAt).toBeNull()
  })

  it("counts runs and computes the success rate over terminal runs only", () => {
    const stats = automationStats([
      run({ status: "succeeded", durationMs: 20_000 }),
      run({ status: "succeeded", durationMs: 40_000 }),
      run({ status: "failed", durationMs: 10_000 }),
      run({ status: "running", durationMs: null, startedAt: "2026-11-20T09:00:00.000Z" }),
      run({ status: "queued", durationMs: null, startedAt: "2026-11-21T09:00:00.000Z" }),
    ])

    expect(stats.runCount).toBe(5)
    expect(stats.terminalRuns).toBe(3)
    expect(stats.succeededCount).toBe(2)
    expect(stats.failedCount).toBe(1)
    expect(stats.successRate).toBeCloseTo(2 / 3)
    // Running/queued runs are excluded from both the rate and the average.
    expect(stats.avgDurationMs).toBeCloseTo(70_000 / 3)
    expect(stats.lastRunAt).toBe("2026-11-21T09:00:00.000Z")
  })

  it("ignores missing, negative, and non-finite durations", () => {
    const stats = automationStats([
      run({ durationMs: undefined }),
      run({ durationMs: null }),
      run({ durationMs: -5 }),
      run({ durationMs: Number.NaN }),
      run({ durationMs: 30_000 }),
    ])
    expect(stats.avgDurationMs).toBe(30_000)
  })

  it("returns a null success rate when only active runs exist", () => {
    const stats = automationStats([run({ status: "running" }), run({ status: "queued" })])
    expect(stats.runCount).toBe(2)
    expect(stats.terminalRuns).toBe(0)
    expect(stats.successRate).toBeNull()
  })
})

describe("workspaceAutomationStats", () => {
  it("rolls up runs across automations", () => {
    const stats = workspaceAutomationStats([
      { runs: [run({ status: "succeeded", durationMs: 10_000 })] },
      {
        runs: [
          run({ status: "failed", durationMs: 30_000 }),
          run({ status: "succeeded", durationMs: 20_000 }),
        ],
      },
      { runs: [] },
    ])

    expect(stats.runCount).toBe(3)
    expect(stats.terminalRuns).toBe(3)
    expect(stats.successRate).toBeCloseTo(2 / 3)
    expect(stats.avgDurationMs).toBeCloseTo(20_000)
  })
})
