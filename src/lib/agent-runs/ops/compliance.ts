/**
 * Agent run compliance — declarative policy checks over recorded runs.
 *
 * A `CompliancePolicy` describes required fields, mandatory tags, retention
 * requirements, and forbidden statuses. `evaluateRunCompliance` produces a
 * per-run report of pass/fail/warn checks; `evaluateRunsCompliance` batches
 * it. Presets cover common postures (standard, strict, retention-focused).
 */

import type { AgentRunRecord, AgentRunOpsStatus } from "./types"

export type ComplianceCheckStatus = "pass" | "fail" | "warn"

export interface ComplianceCheck {
  id: string
  label: string
  status: ComplianceCheckStatus
  detail: string
}

export interface CompliancePolicy {
  id: string
  name: string
  description?: string
  /** Record fields that must be present and non-empty. */
  requiredFields?: (keyof AgentRunRecord)[]
  /** Tags every compliant run must carry. */
  requiredTags?: string[]
  /** Runs must declare a retention window (days > 0). */
  requireRetention?: boolean
  /** Runs must record which model produced them. */
  requireModel?: boolean
  /** Terminal runs must carry a summary. */
  requireSummary?: boolean
  /** Statuses that are never compliant (e.g. "rejected" for audit exports). */
  forbiddenStatuses?: AgentRunOpsStatus[]
  /** Warn (not fail) when a run has no steps recorded. */
  warnOnEmptySteps?: boolean
}

export const COMPLIANCE_POLICIES: readonly CompliancePolicy[] = [
  {
    id: "policy.standard",
    name: "Standard",
    description: "Baseline hygiene: identity fields, tags optional, retention encouraged.",
    requiredFields: ["id", "prompt", "createdAt", "status"],
    requireRetention: false,
    requireModel: false,
    warnOnEmptySteps: true,
  },
  {
    id: "policy.strict",
    name: "Strict",
    description: "Full provenance: model, summary, retention, and required tags.",
    requiredFields: ["id", "prompt", "createdAt", "status", "actor"],
    requiredTags: ["reviewed"],
    requireRetention: true,
    requireModel: true,
    requireSummary: true,
    warnOnEmptySteps: true,
  },
  {
    id: "policy.retention",
    name: "Retention audit",
    description: "For compliance exports: retention window mandatory, rejected runs forbidden.",
    requiredFields: ["id", "prompt", "createdAt", "status"],
    requireRetention: true,
    forbiddenStatuses: ["rejected"],
    warnOnEmptySteps: true,
  },
]

export function getCompliancePolicy(id: string): CompliancePolicy | null {
  return COMPLIANCE_POLICIES.find((p) => p.id === id) ?? null
}

function fieldPresent(run: AgentRunRecord, field: keyof AgentRunRecord): boolean {
  const value = run[field]
  if (value === undefined || value === null) return false
  if (typeof value === "string") return value.trim().length > 0
  if (Array.isArray(value)) return value.length > 0
  return true
}

export function evaluateRunCompliance(
  run: AgentRunRecord,
  policy: CompliancePolicy,
): { checks: ComplianceCheck[]; passed: boolean } {
  const checks: ComplianceCheck[] = []

  for (const field of policy.requiredFields ?? []) {
    const ok = fieldPresent(run, field)
    checks.push({
      id: `field:${String(field)}`,
      label: `Required field “${String(field)}”`,
      status: ok ? "pass" : "fail",
      detail: ok ? "Present." : "Missing or empty.",
    })
  }

  for (const tag of policy.requiredTags ?? []) {
    const ok = run.tags.includes(tag)
    checks.push({
      id: `tag:${tag}`,
      label: `Required tag “${tag}”`,
      status: ok ? "pass" : "fail",
      detail: ok ? "Tag present." : "Tag missing.",
    })
  }

  if (policy.requireRetention) {
    const ok = typeof run.retentionDays === "number" && run.retentionDays > 0
    checks.push({
      id: "retention",
      label: "Retention window declared",
      status: ok ? "pass" : "fail",
      detail: ok ? `${run.retentionDays} day(s).` : "No retentionDays set.",
    })
  }

  if (policy.requireModel) {
    const model = run.metrics.model ?? run.model
    checks.push({
      id: "model",
      label: "Model recorded",
      status: model ? "pass" : "fail",
      detail: model ? `Model: ${model}.` : "No model on run or metrics.",
    })
  }

  if (policy.requireSummary) {
    const terminal = !["queued", "running", "waiting_approval"].includes(run.status)
    if (!terminal) {
      checks.push({
        id: "summary",
        label: "Summary recorded",
        status: "warn",
        detail: "Run still active; summary check deferred.",
      })
    } else {
      const ok = typeof run.summary === "string" && run.summary.trim().length > 0
      checks.push({
        id: "summary",
        label: "Summary recorded",
        status: ok ? "pass" : "fail",
        detail: ok ? "Summary present." : "Terminal run has no summary.",
      })
    }
  }

  if (policy.forbiddenStatuses?.length) {
    const ok = !policy.forbiddenStatuses.includes(run.status)
    checks.push({
      id: "status",
      label: "Status allowed",
      status: ok ? "pass" : "fail",
      detail: ok
        ? `Status “${run.status}” is permitted.`
        : `Status “${run.status}” is forbidden by this policy.`,
    })
  }

  if (policy.warnOnEmptySteps) {
    checks.push({
      id: "steps",
      label: "Steps recorded",
      status: run.steps.length > 0 ? "pass" : "warn",
      detail:
        run.steps.length > 0
          ? `${run.steps.length} step(s).`
          : "No steps recorded — run may be incomplete.",
    })
  }

  const passed = checks.every((c) => c.status !== "fail")
  return { checks, passed }
}

export interface RunComplianceReport {
  runId: string
  policyId: string
  policyName: string
  checks: ComplianceCheck[]
  passed: boolean
  counts: { pass: number; fail: number; warn: number }
}

export function buildComplianceReport(
  run: AgentRunRecord,
  policy: CompliancePolicy,
): RunComplianceReport {
  const { checks, passed } = evaluateRunCompliance(run, policy)
  const counts = { pass: 0, fail: 0, warn: 0 }
  for (const check of checks) counts[check.status] += 1
  return {
    runId: run.id,
    policyId: policy.id,
    policyName: policy.name,
    checks,
    passed,
    counts,
  }
}

export interface BatchComplianceReport {
  policyId: string
  totalRuns: number
  compliantRuns: number
  /** runId -> report, for drill-down UIs. */
  reports: RunComplianceReport[]
}

export function evaluateRunsCompliance(
  runs: readonly AgentRunRecord[],
  policy: CompliancePolicy,
): BatchComplianceReport {
  const reports = runs.map((run) => buildComplianceReport(run, policy))
  return {
    policyId: policy.id,
    totalRuns: runs.length,
    compliantRuns: reports.filter((r) => r.passed).length,
    reports,
  }
}
