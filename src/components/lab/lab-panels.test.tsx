import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { SnapshotAnalysisPanel } from "./snapshot-analysis-panel"
import { PerfReportPanel } from "./perf-report-panel"
import { A11yReportPanel } from "./a11y-report-panel"
import type { SnapshotAnalysis } from "@/lib/lab-snapshots/analyze"
import type { PerfReport } from "@/lib/lab-snapshots/perf"
import type { A11yReport } from "@/lib/lab-snapshots/a11y"

const analysis: SnapshotAnalysis = {
  categories: [
    { category: "content", share: 0.7, findings: 1 },
    { category: "layout", share: 0.3, findings: 1 },
  ],
  significance: 64,
  summary: ["case: 100 of 1000 pixels differ (10.00%)", "Verdict: moderate change."],
  findings: [
    {
      category: "content",
      reason: "Changes concentrate in 1 interior region.",
      weight: 0.8,
    },
  ],
  grid: { columns: 4, rows: 4, changedCells: 2, totalCells: 16 },
}

const perfReport: PerfReport = {
  pass: false,
  findings: [
    {
      name: "shot-a",
      metric: "durationMs",
      value: 900,
      baseline: 400,
      deltaRatio: 1.25,
      reason: "regression",
      severity: "critical",
      message: "durationMs regressed 125% vs baseline median 400",
    },
  ],
  summary: ["shot-a: 900ms, 18.0KiB — durationMs +125% vs baseline"],
  evaluatedAt: new Date().toISOString(),
}

const a11yReport: A11yReport = {
  score: 60,
  pass: false,
  findings: [
    {
      rule: "image-alt",
      severity: "serious",
      message: "<img> is missing an alt attribute.",
      element: '<img src="a.png">',
    },
  ],
  byRule: { "image-alt": 1 },
  summary: ["1 issue(s) found; score 60/100."],
  evaluatedAt: new Date().toISOString(),
}

describe("lab snapshot panels", () => {
  it("SnapshotAnalysisPanel renders significance and summary", () => {
    render(<SnapshotAnalysisPanel analysis={analysis} />)
    expect(screen.getByText(/Significance 64\/100/)).toBeInTheDocument()
    expect(screen.getByText(/moderate change/)).toBeInTheDocument()
    expect(screen.getByText(/Content:/)).toBeInTheDocument()
  })

  it("PerfReportPanel renders findings and failing badge", () => {
    render(<PerfReportPanel report={perfReport} />)
    expect(screen.getByText("Regressions found")).toBeInTheDocument()
    expect(screen.getByText(/regressed 125%/)).toBeInTheDocument()
  })

  it("PerfReportPanel renders clean state", () => {
    render(
      <PerfReportPanel report={{ ...perfReport, pass: true, findings: [], summary: ["ok"] }} />,
    )
    expect(screen.getByText("Within budget")).toBeInTheDocument()
    expect(screen.getByText("No performance findings.")).toBeInTheDocument()
  })

  it("A11yReportPanel renders score and findings", () => {
    render(<A11yReportPanel report={a11yReport} />)
    expect(screen.getByText(/Score 60\/100/)).toBeInTheDocument()
    expect(screen.getByText("image-alt")).toBeInTheDocument()
    expect(screen.getByText(/missing an alt/)).toBeInTheDocument()
  })
})
