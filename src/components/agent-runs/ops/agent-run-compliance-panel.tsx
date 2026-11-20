"use client"

import { useMemo, useState } from "react"
import { ClipboardCheck } from "lucide-react"

import {
  buildComplianceReport,
  COMPLIANCE_POLICIES,
  type CompliancePolicy,
} from "@/lib/agent-runs/ops/compliance"
import type { AgentRunRecord } from "@/lib/agent-runs/ops/types"

function checkBadgeClass(status: "pass" | "fail" | "warn"): string {
  if (status === "pass") return "is-done"
  if (status === "fail") return "is-failed"
  return "is-waiting_approval"
}

/** Per-run compliance report against a selectable policy preset. */
export function AgentRunCompliancePanel({ run }: { run: AgentRunRecord }) {
  const [policyId, setPolicyId] = useState<string>(COMPLIANCE_POLICIES[0]?.id ?? "")
  const policy: CompliancePolicy | undefined = useMemo(
    () => COMPLIANCE_POLICIES.find((p) => p.id === policyId) ?? COMPLIANCE_POLICIES[0],
    [policyId],
  )
  const report = useMemo(() => (policy ? buildComplianceReport(run, policy) : null), [run, policy])

  return (
    <section className="app-panel" aria-labelledby="compliance-heading">
      <div className="app-panel-head">
        <div>
          <h2 id="compliance-heading">
            <ClipboardCheck aria-hidden="true" className="app-panel-icon" /> Compliance
          </h2>
          <p>Policy checks for required fields, tags, retention, and status.</p>
        </div>
        <label className="app-compliance-policy">
          Policy{" "}
          <select value={policyId} onChange={(e) => setPolicyId(e.target.value)}>
            {COMPLIANCE_POLICIES.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {report ? (
        <>
          <p className="app-share-note">
            <span className={`app-badge ${report.passed ? "is-done" : "is-failed"}`}>
              {report.passed ? "compliant" : "non-compliant"}
            </span>{" "}
            {report.counts.pass} pass · {report.counts.fail} fail · {report.counts.warn} warn —{" "}
            {policy?.description}
          </p>
          <ul className="app-compliance-checks">
            {report.checks.map((check) => (
              <li key={check.id} className="app-compliance-check">
                <span className={`app-badge ${checkBadgeClass(check.status)}`}>{check.status}</span>
                <span className="app-compliance-check-label">{check.label}</span>
                <span className="app-share-note">{check.detail}</span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="app-runlog-empty-steps">No policy selected.</p>
      )}
    </section>
  )
}
