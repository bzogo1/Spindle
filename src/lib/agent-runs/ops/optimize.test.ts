import { describe, expect, it } from "vitest"

import { analyzeRunOptimization } from "./optimize"
import { buildOpsEvent, buildOpsRun, buildOpsStep } from "./fixtures"

describe("analyzeRunOptimization", () => {
  it("returns a clean report for a tidy run", () => {
    const report = analyzeRunOptimization(buildOpsRun())
    expect(report.findings).toEqual([])
    expect(report.summary).toContain("No optimization")
    expect(report.estimatedWasteMs).toBe(0)
  })

  it("detects consecutive redundant steps", () => {
    const run = buildOpsRun({
      steps: [
        buildOpsStep({ id: "a", title: "Fetch config", kind: "tool_call", durationMs: 1000 }),
        buildOpsStep({ id: "b", title: "Fetch config", kind: "tool_call", durationMs: 2000 }),
        buildOpsStep({ id: "c", title: "Fetch config", kind: "tool_call", durationMs: 3000 }),
      ],
    })
    const report = analyzeRunOptimization(run)
    const finding = report.findings.find((f) => f.category === "redundant")
    expect(finding).toBeTruthy()
    expect(finding!.stepIds).toEqual(["a", "b", "c"])
    expect(finding!.wastedMs).toBe(5000) // later copies only
    expect(finding!.title).toContain("×3")
  })

  it("detects retry waste from failed attempts", () => {
    const run = buildOpsRun({
      steps: [
        buildOpsStep({
          id: "f1",
          title: "Deploy",
          kind: "tool_call",
          status: "failed",
          durationMs: 4000,
        }),
        buildOpsStep({
          id: "f2",
          title: "Deploy",
          kind: "tool_call",
          status: "failed",
          durationMs: 6000,
        }),
        buildOpsStep({
          id: "ok",
          title: "Deploy",
          kind: "tool_call",
          status: "done",
          durationMs: 1000,
        }),
      ],
    })
    const report = analyzeRunOptimization(run)
    const retry = report.findings.find((f) => f.category === "retry")
    expect(retry).toBeTruthy()
    expect(retry!.wastedMs).toBe(10_000)
    expect(retry!.severity).toBe("warning")
  })

  it("does not flag retries when there was only one attempt", () => {
    const run = buildOpsRun({
      steps: [
        buildOpsStep({
          id: "f1",
          title: "Deploy",
          kind: "tool_call",
          status: "failed",
          durationMs: 4000,
        }),
      ],
    })
    const report = analyzeRunOptimization(run)
    expect(report.findings.filter((f) => f.category === "retry")).toEqual([])
  })

  it("detects context bloat from large payloads", () => {
    const bigPayload = { blob: "x".repeat(80 * 1024) }
    const run = buildOpsRun({
      steps: [
        buildOpsStep({
          id: "big",
          kind: "tool_call",
          title: "Dump table",
          payload: bigPayload,
        }),
      ],
      events: Array.from({ length: 600 }, (_, i) =>
        buildOpsEvent({ id: `ev${i}`, message: `tick ${i}` }),
      ),
    })
    const report = analyzeRunOptimization(run)
    const bloat = report.findings.filter((f) => f.category === "context")
    expect(bloat.length).toBeGreaterThanOrEqual(2) // run-level + step-level
    expect(report.payloadBytes).toBeGreaterThan(64 * 1024)
  })

  it("flags long serial tool-call chains", () => {
    const steps = Array.from({ length: 5 }, (_, i) =>
      buildOpsStep({
        id: `t${i}`,
        kind: "tool_call",
        title: `Tool ${i}`,
        durationMs: 100,
      }),
    )
    const run = buildOpsRun({ steps })
    const report = analyzeRunOptimization(run)
    const chain = report.findings.find((f) => f.category === "structure")
    expect(chain).toBeTruthy()
    expect(chain!.title).toContain("5")
  })

  it("does not flag same-titled steps with different payloads as redundant/retry", () => {
    const run = buildOpsRun({
      steps: [
        buildOpsStep({
          id: "w1",
          title: "Write file",
          kind: "tool_call",
          status: "failed",
          durationMs: 1000,
          payload: { path: "a.ts" },
        }),
        buildOpsStep({
          id: "w2",
          title: "Write file",
          kind: "tool_call",
          status: "done",
          durationMs: 1000,
          payload: { path: "b.ts" }, // different target — not a retry of the same work
        }),
      ],
    })
    const report = analyzeRunOptimization(run)
    expect(report.findings.filter((f) => f.category === "redundant")).toEqual([])
    expect(report.findings.filter((f) => f.category === "retry")).toEqual([])
  })

  it("aggregates estimated waste and category counts", () => {
    const run = buildOpsRun({
      steps: [
        buildOpsStep({
          id: "a",
          title: "Same",
          kind: "tool_call",
          status: "failed",
          durationMs: 1000,
        }),
        buildOpsStep({
          id: "b",
          title: "Same",
          kind: "tool_call",
          status: "done",
          durationMs: 1000,
        }),
      ],
    })
    const report = analyzeRunOptimization(run)
    // redundant (1s) + retry (1s) both fire on the same pair — upper bound.
    expect(report.byCategory.redundant).toBe(1)
    expect(report.byCategory.retry).toBe(1)
    expect(report.estimatedWasteMs).toBeGreaterThanOrEqual(2000)
  })
})
