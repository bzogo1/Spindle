import { describe, expect, it } from "vitest"

import { buildPerfBaselines, evaluatePerfReport, type CaptureMetrics } from "./perf"

const metric = (name: string, durationMs: number, bytes = 100_000): CaptureMetrics => ({
  name,
  durationMs,
  bytes,
})

describe("buildPerfBaselines", () => {
  it("computes medians and maxes per name", () => {
    const baselines = buildPerfBaselines([
      metric("shot-a", 100),
      metric("shot-a", 200),
      metric("shot-a", 300),
      metric("shot-b", 50, 10_000),
    ])
    const a = baselines.find((b) => b.name === "shot-a")!
    expect(a.medianDurationMs).toBe(200)
    expect(a.maxDurationMs).toBe(300)
    expect(a.samples).toBe(3)
    const b = baselines.find((b) => b.name === "shot-b")!
    expect(b.medianBytes).toBe(10_000)
  })

  it("merges with previous baselines", () => {
    const first = buildPerfBaselines([metric("shot-a", 100)])
    const second = buildPerfBaselines([metric("shot-a", 300)], first)
    const entry = second.find((b) => b.name === "shot-a")!
    expect(entry.samples).toBeGreaterThan(1)
    expect(entry.maxDurationMs).toBe(300)
  })
})

describe("evaluatePerfReport", () => {
  it("passes clean metrics", () => {
    const report = evaluatePerfReport([metric("shot-a", 120, 50_000)])
    expect(report.pass).toBe(true)
    expect(report.findings).toHaveLength(0)
    expect(report.summary[0]).toContain("shot-a")
  })

  it("flags absolute threshold breaches as critical", () => {
    const report = evaluatePerfReport([metric("shot-a", 5_000)], [], {
      maxDurationMs: 2_000,
    })
    expect(report.pass).toBe(false)
    expect(report.findings[0].reason).toBe("threshold")
    expect(report.findings[0].severity).toBe("critical")
  })

  it("flags regressions vs baseline median", () => {
    const baselines = buildPerfBaselines([
      metric("shot-a", 100),
      metric("shot-a", 100),
      metric("shot-a", 100),
    ])
    const report = evaluatePerfReport([metric("shot-a", 140)], baselines)
    expect(report.pass).toBe(true) // warning-level, not critical
    expect(report.findings.some((f) => f.reason === "regression")).toBe(true)
    expect(report.findings[0].deltaRatio).toBeCloseTo(0.4)
  })

  it("treats large regressions as critical", () => {
    const baselines = buildPerfBaselines([metric("shot-a", 100)])
    const report = evaluatePerfReport([metric("shot-a", 400)], baselines)
    expect(report.pass).toBe(false)
    expect(report.findings.some((f) => f.severity === "critical")).toBe(true)
  })

  it("respects a custom maxRegressionRatio", () => {
    const baselines = buildPerfBaselines([metric("shot-a", 100)])
    const lenient = evaluatePerfReport([metric("shot-a", 110)], baselines, {
      maxRegressionRatio: 0.5,
    })
    expect(lenient.findings).toHaveLength(0)
  })
})
