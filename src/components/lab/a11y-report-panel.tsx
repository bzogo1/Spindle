"use client"

/**
 * Panel rendering a static accessibility report
 * (`analyzeHtmlForA11y` in `src/lib/lab-snapshots/a11y.ts`). Complements the
 * axe-core e2e spec — this checks stored snapshot markup without a browser.
 */

import type { A11yReport } from "@/lib/lab-snapshots/a11y"

const SEVERITY_ORDER = ["critical", "serious", "moderate", "minor"] as const

export function A11yReportPanel({ report }: { report: A11yReport }) {
  const sorted = [...report.findings].sort(
    (a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity),
  )

  return (
    <section className="app-panel" aria-labelledby="a11y-report-heading">
      <div className="app-panel-head">
        <div>
          <h2 id="a11y-report-heading">Accessibility scan</h2>
          <p>Static heuristics over captured markup — run axe-core e2e for full coverage.</p>
        </div>
        <span className={`app-badge ${report.pass ? "is-succeeded" : "is-failed"}`}>
          Score {report.score}/100
        </span>
      </div>

      {sorted.length === 0 ? (
        <p className="app-field-hint">No issues found by static checks.</p>
      ) : (
        <ul className="space-y-2">
          {sorted.map((f, i) => (
            <li key={i} className="text-sm">
              <span
                className={`app-badge mr-2 ${
                  f.severity === "critical" || f.severity === "serious" ? "is-failed" : ""
                }`}
              >
                {f.severity}
              </span>
              <code className="mr-1 text-xs">{f.rule}</code>
              {f.message}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
