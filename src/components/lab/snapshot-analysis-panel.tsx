"use client"

/**
 * Panel rendering the heuristic snapshot-diff analysis
 * (`analyzeSnapshotDiff` in `src/lib/lab-snapshots/analyze.ts`): categorized
 * findings, significance score, and rule-based summary sentences.
 *
 * Type-only import — the lib module is server-side (pngjs); the report is
 * computed server-side and passed in as plain data.
 */

import type { SnapshotAnalysis } from "@/lib/lab-snapshots/analyze"

const CATEGORY_LABEL: Record<string, string> = {
  layout: "Layout",
  visual: "Visual",
  content: "Content",
  noise: "Noise",
}

const CATEGORY_ORDER = ["layout", "visual", "content", "noise"] as const

function significanceTone(score: number): string {
  if (score >= 70) return "is-failed"
  if (score >= 30) return "is-running"
  return "is-succeeded"
}

export function SnapshotAnalysisPanel({ analysis }: { analysis: SnapshotAnalysis }) {
  const ordered = [...analysis.categories].sort(
    (a, b) =>
      CATEGORY_ORDER.indexOf(a.category as (typeof CATEGORY_ORDER)[number]) -
      CATEGORY_ORDER.indexOf(b.category as (typeof CATEGORY_ORDER)[number]),
  )

  return (
    <section className="app-panel" aria-labelledby="snapshot-analysis-heading">
      <div className="app-panel-head">
        <div>
          <h2 id="snapshot-analysis-heading">Change analysis</h2>
          <p>Heuristic categorization of the diff — no external AI involved.</p>
        </div>
        <span
          className={`app-badge ${significanceTone(analysis.significance)}`}
          title="Significance score 0–100"
        >
          Significance {analysis.significance}/100
        </span>
      </div>

      <div className="mb-3">
        <div
          className="h-2 w-full rounded bg-[var(--app-panel-alt)]"
          role="progressbar"
          aria-valuenow={analysis.significance}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Change significance"
        >
          <div
            className="h-2 rounded bg-[var(--accent,#5b8cff)]"
            style={{ width: `${analysis.significance}%` }}
          />
        </div>
      </div>

      {ordered.length > 0 ? (
        <ul className="mb-3 flex flex-wrap gap-2">
          {ordered.map((c) => (
            <li
              key={c.category}
              className="app-badge"
              title={`${c.findings} finding(s), ${(c.share * 100).toFixed(0)}% of attributed diff`}
            >
              {CATEGORY_LABEL[c.category] ?? c.category}: {(c.share * 100).toFixed(0)}%
            </li>
          ))}
        </ul>
      ) : null}

      <ul className="space-y-2">
        {analysis.summary.map((line, i) => (
          <li key={i} className="text-sm text-[var(--app-muted,#8b98b0)]">
            {line}
          </li>
        ))}
      </ul>

      {analysis.findings.length > 0 ? (
        <details className="mt-3">
          <summary className="app-field-hint cursor-pointer">
            Findings ({analysis.findings.length})
          </summary>
          <ul className="mt-2 space-y-1">
            {analysis.findings.map((f, i) => (
              <li key={i} className="text-sm">
                <span className="app-badge mr-2">{CATEGORY_LABEL[f.category] ?? f.category}</span>
                {f.reason}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  )
}
