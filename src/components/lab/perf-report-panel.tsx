"use client"

/**
 * Panel rendering a capture-performance report
 * (`evaluatePerfReport` in `src/lib/lab-snapshots/perf.ts`): per-capture
 * timings/sizes plus threshold and baseline-regression findings.
 */

import type { PerfFinding, PerfReport } from "@/lib/lab-snapshots/perf"

function severityBadge(severity: PerfFinding["severity"]): string {
  if (severity === "critical") return "is-failed"
  if (severity === "warning") return "is-running"
  return ""
}

export function PerfReportPanel({
  report,
  title = "Capture performance",
}: {
  report: PerfReport
  title?: string
}) {
  return (
    <section className="app-panel" aria-labelledby="perf-report-heading">
      <div className="app-panel-head">
        <div>
          <h2 id="perf-report-heading">{title}</h2>
          <p>Capture timings and payload sizes vs thresholds and baseline medians.</p>
        </div>
        <span className={`app-badge ${report.pass ? "is-succeeded" : "is-failed"}`}>
          {report.pass ? "Within budget" : "Regressions found"}
        </span>
      </div>

      <ul className="mb-3 space-y-1">
        {report.summary.map((line, i) => (
          <li key={i} className="text-sm text-[var(--app-muted,#8b98b0)]">
            {line}
          </li>
        ))}
      </ul>

      {report.findings.length > 0 ? (
        <ul className="space-y-2">
          {report.findings.map((f, i) => (
            <li key={i} className="text-sm">
              <span className={`app-badge mr-2 ${severityBadge(f.severity)}`}>{f.severity}</span>
              <strong>{f.name}</strong> — {f.message}
            </li>
          ))}
        </ul>
      ) : (
        <p className="app-field-hint">No performance findings.</p>
      )}
    </section>
  )
}
