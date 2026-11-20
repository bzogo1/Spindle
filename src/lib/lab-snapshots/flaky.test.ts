import { describe, expect, it } from "vitest"

import { analyzeFlakiness, parseHistoryJsonl, type SnapshotRunRecord } from "./flaky"

const rec = (
  caseName: string,
  pass: boolean,
  diffRatio: number,
  extra: Partial<SnapshotRunRecord> = {},
): SnapshotRunRecord => ({ caseName, pass, diffRatio, ...extra })

describe("analyzeFlakiness", () => {
  it("marks consistently passing cases stable", () => {
    const records = Array.from({ length: 5 }, () => rec("stable-case", true, 0))
    const report = analyzeFlakiness(records)
    expect(report.cases[0].verdict).toBe("stable")
    expect(report.quarantine).toHaveLength(0)
  })

  it("detects flaky pass rates", () => {
    const records = [
      rec("flaky-case", true, 0),
      rec("flaky-case", false, 0.02),
      rec("flaky-case", true, 0),
      rec("flaky-case", false, 0.01),
      rec("flaky-case", true, 0),
    ]
    const report = analyzeFlakiness(records)
    const c = report.cases.find((x) => x.caseName === "flaky-case")!
    expect(c.passRate).toBeCloseTo(0.6)
    expect(c.verdict).toBe("flaky")
    expect(report.quarantine).toContain("flaky-case")
  })

  it("detects high diff-ratio variance even when all pass", () => {
    const records = [
      rec("wobbly", true, 0.001),
      rec("wobbly", true, 0.05),
      rec("wobbly", true, 0.001),
      rec("wobbly", true, 0.04),
      rec("wobbly", true, 0.002),
    ]
    const report = analyzeFlakiness(records)
    const c = report.cases.find((x) => x.caseName === "wobbly")!
    expect(c.diffRatioCv).toBeGreaterThan(0.5)
    expect(c.verdict).toBe("flaky")
  })

  it("marks low-sample cases as watch, not flaky", () => {
    const report = analyzeFlakiness([rec("new-case", false, 0.5)])
    const c = report.cases[0]
    expect(c.verdict).toBe("watch")
    expect(c.reasons.join(" ")).toContain("run(s) recorded")
  })

  it("respects an existing quarantine list", () => {
    const records = Array.from({ length: 4 }, () => rec("q-case", true, 0))
    const report = analyzeFlakiness(records, { alreadyQuarantined: ["q-case"] })
    expect(report.cases[0].verdict).toBe("quarantined")
    expect(report.quarantine).toHaveLength(0) // already quarantined ≠ new candidate
  })

  it("counts retried attempts as a flakiness signal", () => {
    const records = [
      rec("retry-case", true, 0, { attempts: 2 }),
      rec("retry-case", true, 0),
      rec("retry-case", true, 0),
    ]
    const report = analyzeFlakiness(records)
    const c = report.cases[0]
    expect(c.reasons.join(" ")).toContain("retries")
  })
})

describe("parseHistoryJsonl", () => {
  it("parses valid lines and skips malformed ones", () => {
    const content = [
      JSON.stringify({ caseName: "a", pass: true, diffRatio: 0, runId: "r1" }),
      "not json",
      JSON.stringify({ case: "b", pass: false, diffRatio: 0.1 }),
      "",
    ].join("\n")
    const records = parseHistoryJsonl(content)
    expect(records).toHaveLength(2)
    expect(records[0].caseName).toBe("a")
    expect(records[1].caseName).toBe("b")
    expect(records[1].pass).toBe(false)
  })
})
