"use client"

import { useMemo, useState } from "react"
import { ShieldAlert, ShieldCheck } from "lucide-react"

import { buildSecurityReport, redactRun, scanRunForSecrets } from "@/lib/agent-runs/ops/security"
import type { AgentRunRecord } from "@/lib/agent-runs/ops/types"

/**
 * Security panel: scans a run's steps/events for secrets and PII, shows the
 * findings, and offers a "copy redacted run" action that exports a sanitized
 * JSON snapshot.
 */
export function AgentRunSecurityPanel({ run }: { run: AgentRunRecord }) {
  const scan = useMemo(() => scanRunForSecrets(run), [run])
  const report = useMemo(() => buildSecurityReport(scan), [scan])
  const [copied, setCopied] = useState(false)

  const copyRedacted = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(redactRun(run), null, 2))
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }

  return (
    <section className="app-panel" aria-labelledby="security-heading">
      <div className="app-panel-head">
        <div>
          <h2 id="security-heading">
            {report.risk === "clean" ? (
              <ShieldCheck aria-hidden="true" className="app-panel-icon" />
            ) : (
              <ShieldAlert aria-hidden="true" className="app-panel-icon" />
            )}{" "}
            Security scan
          </h2>
          <p>
            {scan.scannedFields} fields scanned · {scan.totalMatches} match
            {scan.totalMatches === 1 ? "" : "es"} · risk{" "}
            <span
              className={`app-badge is-${report.risk === "clean" ? "done" : report.risk === "low" ? "queued" : report.risk === "medium" ? "waiting_approval" : "failed"}`}
            >
              {report.risk}
            </span>
          </p>
        </div>
        {scan.findings.length > 0 ? (
          <button type="button" className="fm-btn" onClick={() => void copyRedacted()}>
            {copied ? "Copied!" : "Copy redacted run"}
          </button>
        ) : null}
      </div>

      {report.findings.length === 0 ? (
        <p className="app-runlog-empty-steps">
          No secrets or PII patterns detected in steps, payloads, or events.
        </p>
      ) : (
        <ul className="app-opt-findings">
          {report.findings.map((finding) => (
            <li
              key={finding.detector}
              className={`app-opt-finding is-${finding.severity === "low" ? "info" : finding.severity}`}
            >
              <div className="app-opt-finding-head">
                <span
                  className={`app-badge is-${finding.severity === "critical" || finding.severity === "high" ? "failed" : finding.severity === "medium" ? "waiting_approval" : "queued"}`}
                >
                  {finding.severity}
                </span>
                <strong>{finding.label}</strong>
                <span className="app-opt-waste">×{finding.count}</span>
              </div>
              <p>
                Sample: <code>{finding.sample}</code>
              </p>
              <p className="app-share-note">
                Locations:{" "}
                {finding.locations
                  .slice(0, 5)
                  .map((l) => `${l.target}:${l.ref} (${l.field})`)
                  .join(", ")}
                {finding.locations.length > 5 ? ` +${finding.locations.length - 5} more` : ""}
              </p>
            </li>
          ))}
        </ul>
      )}

      <div className="app-profile-bottlenecks">
        <h3 className="app-analytics-subhead">Recommendations</h3>
        <ul>
          {report.recommendations.map((rec) => (
            <li key={rec}>{rec}</li>
          ))}
        </ul>
      </div>
    </section>
  )
}
