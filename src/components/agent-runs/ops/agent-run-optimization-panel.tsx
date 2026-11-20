"use client"

import { useMemo } from "react"
import { Lightbulb, TrendingDown } from "lucide-react"

import { analyzeRunOptimization, type OptimizationSeverity } from "@/lib/agent-runs/ops/optimize"
import type { AgentRunRecord } from "@/lib/agent-runs/ops/types"

const SEVERITY_ORDER: Record<OptimizationSeverity, number> = {
  critical: 0,
  warning: 1,
  info: 2,
}

/** Post-run optimization report: redundant steps, retry waste, context bloat. */
export function AgentRunOptimizationPanel({ run }: { run: AgentRunRecord }) {
  const report = useMemo(() => analyzeRunOptimization(run), [run])
  const findings = useMemo(
    () =>
      [...report.findings].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]),
    [report],
  )

  return (
    <section className="app-panel" aria-labelledby="optimize-heading">
      <div className="app-panel-head">
        <div>
          <h2 id="optimize-heading">
            <TrendingDown aria-hidden="true" className="app-panel-icon" /> Optimization
          </h2>
          <p>{report.summary}</p>
        </div>
      </div>

      {findings.length === 0 ? (
        <p className="app-runlog-empty-steps">
          <Lightbulb aria-hidden="true" className="size-4" /> No waste patterns detected — this run
          looks efficient.
        </p>
      ) : (
        <ul className="app-opt-findings">
          {findings.map((finding) => (
            <li key={finding.id} className={`app-opt-finding is-${finding.severity}`}>
              <div className="app-opt-finding-head">
                <span
                  className={`app-badge is-${finding.severity === "critical" ? "failed" : finding.severity === "warning" ? "waiting_approval" : "queued"}`}
                >
                  {finding.severity}
                </span>
                <strong>{finding.title}</strong>
                <span className="app-badge">{finding.category}</span>
                {finding.wastedMs > 0 ? (
                  <span className="app-opt-waste">
                    ~{Math.round(finding.wastedMs / 1000)}s waste
                  </span>
                ) : null}
              </div>
              <p>{finding.detail}</p>
              <p className="app-opt-hint">
                <Lightbulb aria-hidden="true" className="size-3.5" /> {finding.hint}
              </p>
            </li>
          ))}
        </ul>
      )}

      <p className="app-share-note">
        Payload footprint: ~{Math.round(report.payloadBytes / 1024)}KB across steps and events.
      </p>
    </section>
  )
}
