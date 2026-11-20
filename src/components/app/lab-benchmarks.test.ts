import { describe, expect, it } from "vitest"

import {
  LAB_BENCHMARK_RUNS_PER_SNAPSHOT,
  LAB_SNAPSHOTS,
  labSnapshotBenchmarkRuns,
  type LabBenchmarkRun,
  type LabSnapshot,
} from "./lab-mock"
import {
  DEFAULT_BENCHMARK_FAIL_RATIO,
  DEFAULT_BENCHMARK_WARN_RATIO,
  benchmarkRunStatus,
  benchmarkStatusBadgeClass,
  benchmarkStatusLabel,
  compareBenchmarkRuns,
  formatBenchmarkDelta,
  formatBenchmarkDeltaRatio,
  labBenchmarkBaseline,
} from "./lab-benchmarks"

const snapshot: LabSnapshot = {
  id: "snap-test",
  name: "Test capture",
  environment: "RStudio",
  description: "Fixture for benchmark tests.",
  sizeBytes: 48 * 1024 * 1024,
  createdAt: "2026-11-18T16:40:00.000Z",
}

function makeRun(overrides: Partial<LabBenchmarkRun> = {}): LabBenchmarkRun {
  return {
    id: "snap-test:bench-1",
    snapshotId: "snap-test",
    runIndex: 1,
    renderMs: 200,
    captureMs: 100,
    totalMs: 300,
    createdAt: "2026-11-18T15:40:00.000Z",
    ...overrides,
  }
}

describe("labSnapshotBenchmarkRuns", () => {
  it("is deterministic per snapshot and differs across snapshots", () => {
    const first = labSnapshotBenchmarkRuns(snapshot)
    const second = labSnapshotBenchmarkRuns(snapshot)
    expect(first).toEqual(second)

    const other = labSnapshotBenchmarkRuns({ ...snapshot, id: "snap-other" })
    expect(other.map((run) => run.totalMs)).not.toEqual(first.map((run) => run.totalMs))
  })

  it("seeds the configured number of runs per snapshot", () => {
    const runs = labSnapshotBenchmarkRuns(snapshot)
    expect(runs).toHaveLength(LAB_BENCHMARK_RUNS_PER_SNAPSHOT)
    expect(runs.map((run) => run.runIndex)).toEqual([1, 2, 3, 4, 5])
    expect(new Set(runs.map((run) => run.id)).size).toBe(runs.length)
  })

  it("reports consistent render/capture/total timings", () => {
    for (const run of labSnapshotBenchmarkRuns(snapshot)) {
      expect(run.renderMs).toBeGreaterThan(0)
      expect(run.captureMs).toBeGreaterThan(0)
      expect(run.totalMs).toBe(run.renderMs + run.captureMs)
    }
  })

  it("orders runs oldest → newest ending before the snapshot timestamp", () => {
    const runs = labSnapshotBenchmarkRuns(snapshot)
    const times = runs.map((run) => new Date(run.createdAt).getTime())
    for (let i = 1; i < times.length; i++) {
      expect(times[i]).toBeGreaterThan(times[i - 1])
    }
    expect(times[times.length - 1]).toBeLessThan(new Date(snapshot.createdAt).getTime())
  })

  it("produces seeded histories for every catalog snapshot", () => {
    for (const entry of LAB_SNAPSHOTS) {
      const runs = labSnapshotBenchmarkRuns(entry)
      expect(runs).toHaveLength(LAB_BENCHMARK_RUNS_PER_SNAPSHOT)
      expect(labBenchmarkBaseline(runs)).toBeGreaterThan(0)
    }
  })
})

describe("labBenchmarkBaseline", () => {
  it("returns the median totalMs", () => {
    const runs = [makeRun({ totalMs: 100 }), makeRun({ totalMs: 300 }), makeRun({ totalMs: 200 })]
    expect(labBenchmarkBaseline(runs)).toBe(200)
  })

  it("returns null for an empty history", () => {
    expect(labBenchmarkBaseline([])).toBeNull()
  })
})

describe("benchmarkRunStatus", () => {
  it("passes runs at or below the warn ratio and null baselines", () => {
    expect(benchmarkRunStatus(makeRun({ totalMs: 300 }), 300)).toBe("pass")
    expect(benchmarkRunStatus(makeRun({ totalMs: 330 }), 300)).toBe("pass")
    expect(benchmarkRunStatus(makeRun({ totalMs: 999 }), null)).toBe("pass")
    expect(benchmarkRunStatus(makeRun({ totalMs: 999 }), 0)).toBe("pass")
  })

  it("warns between the warn and fail ratios", () => {
    // +15% over a 300ms baseline.
    expect(benchmarkRunStatus(makeRun({ totalMs: 345 }), 300)).toBe("warn")
  })

  it("fails above the fail ratio", () => {
    // +30% over a 300ms baseline.
    expect(benchmarkRunStatus(makeRun({ totalMs: 390 }), 300)).toBe("fail")
  })

  it("honors custom thresholds", () => {
    expect(benchmarkRunStatus(makeRun({ totalMs: 320 }), 300, { warnRatio: 0.05 })).toBe("warn")
    expect(
      benchmarkRunStatus(makeRun({ totalMs: 340 }), 300, {
        warnRatio: 0.01,
        failRatio: 0.1,
      }),
    ).toBe("fail")
  })

  it("uses the documented default ratios", () => {
    expect(DEFAULT_BENCHMARK_WARN_RATIO).toBe(0.1)
    expect(DEFAULT_BENCHMARK_FAIL_RATIO).toBe(0.25)
  })
})

describe("compareBenchmarkRuns", () => {
  it("reports candidate-minus-reference deltas", () => {
    const reference = makeRun({ renderMs: 200, captureMs: 100, totalMs: 300 })
    const candidate = makeRun({
      id: "snap-test:bench-2",
      renderMs: 180,
      captureMs: 90,
      totalMs: 270,
    })
    const result = compareBenchmarkRuns(reference, candidate)
    expect(result.renderDeltaMs).toBe(-20)
    expect(result.captureDeltaMs).toBe(-10)
    expect(result.totalDeltaMs).toBe(-30)
    expect(result.totalDeltaRatio).toBeCloseTo(-0.1)
    expect(result.faster).toBe(true)
  })

  it("marks slower candidates and nulls the ratio for a zero reference", () => {
    const reference = makeRun({ totalMs: 0 })
    const candidate = makeRun({ totalMs: 50 })
    const result = compareBenchmarkRuns(reference, candidate)
    expect(result.faster).toBe(false)
    expect(result.totalDeltaRatio).toBeNull()
  })
})

describe("benchmark presentation helpers", () => {
  it("maps statuses to labels and badge classes", () => {
    expect(benchmarkStatusLabel("pass")).toBe("Within budget")
    expect(benchmarkStatusLabel("warn")).toBe("Warning")
    expect(benchmarkStatusLabel("fail")).toBe("Regression")
    expect(benchmarkStatusBadgeClass("pass")).toBe("is-succeeded")
    expect(benchmarkStatusBadgeClass("warn")).toBe("is-warn")
    expect(benchmarkStatusBadgeClass("fail")).toBe("is-failed")
  })

  it("formats signed deltas", () => {
    expect(formatBenchmarkDelta(0)).toBe("±0ms")
    expect(formatBenchmarkDelta(340)).toBe("+340ms")
    expect(formatBenchmarkDelta(-1300)).toBe("-1.3s")
    expect(formatBenchmarkDeltaRatio(0.125)).toBe("+12.5%")
    expect(formatBenchmarkDeltaRatio(-0.05)).toBe("-5.0%")
    expect(formatBenchmarkDeltaRatio(null)).toBe("—")
  })
})
