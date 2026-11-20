import { describe, expect, it } from "vitest"

import {
  buildComplianceReport,
  COMPLIANCE_POLICIES,
  evaluateRunCompliance,
  evaluateRunsCompliance,
  getCompliancePolicy,
} from "./compliance"
import { buildOpsRun } from "./fixtures"

describe("compliance policies", () => {
  it("ships presets with unique ids", () => {
    expect(COMPLIANCE_POLICIES.length).toBeGreaterThanOrEqual(3)
    expect(new Set(COMPLIANCE_POLICIES.map((p) => p.id)).size).toBe(COMPLIANCE_POLICIES.length)
    expect(getCompliancePolicy("policy.strict")?.name).toBe("Strict")
    expect(getCompliancePolicy("nope")).toBeNull()
  })

  it("standard policy passes a well-formed run", () => {
    const policy = getCompliancePolicy("policy.standard")!
    const report = buildComplianceReport(buildOpsRun(), policy)
    expect(report.passed).toBe(true)
    expect(report.counts.fail).toBe(0)
    expect(report.counts.pass).toBeGreaterThan(0)
  })

  it("fails required fields and tags under strict policy", () => {
    const policy = getCompliancePolicy("policy.strict")!
    const run = buildOpsRun({
      actor: undefined,
      retentionDays: undefined,
      summary: undefined,
      tags: [],
    })
    const { checks, passed } = evaluateRunCompliance(run, policy)
    expect(passed).toBe(false)
    const failed = checks.filter((c) => c.status === "fail")
    expect(failed.some((c) => c.id === "field:actor")).toBe(true)
    expect(failed.some((c) => c.id === "tag:reviewed")).toBe(true)
    expect(failed.some((c) => c.id === "retention")).toBe(true)
    expect(failed.some((c) => c.id === "summary")).toBe(true)
  })

  it("strict policy passes a fully-provisioned run", () => {
    const policy = getCompliancePolicy("policy.strict")!
    const run = buildOpsRun({
      actor: "auditor",
      tags: ["reviewed"],
      retentionDays: 365,
      summary: "Reviewed output.",
      metrics: { model: "writer-small" },
    })
    const report = buildComplianceReport(run, policy)
    expect(report.passed).toBe(true)
    expect(report.counts.warn).toBe(0)
  })

  it("retention policy forbids rejected runs", () => {
    const policy = getCompliancePolicy("policy.retention")!
    const bad = buildOpsRun({ status: "rejected", retentionDays: 30 })
    const good = buildOpsRun({ status: "succeeded", retentionDays: 30 })
    expect(buildComplianceReport(bad, policy).passed).toBe(false)
    expect(buildComplianceReport(good, policy).passed).toBe(true)
  })

  it("warns (not fails) on empty steps and deferred summary", () => {
    const policy = getCompliancePolicy("policy.standard")!
    const run = buildOpsRun({ steps: [], status: "running", summary: undefined })
    const { checks } = evaluateRunCompliance(run, policy)
    const steps = checks.find((c) => c.id === "steps")
    expect(steps?.status).toBe("warn")
  })

  it("batch evaluation counts compliant runs", () => {
    const policy = getCompliancePolicy("policy.standard")!
    const runs = [buildOpsRun({ id: "a" }), buildOpsRun({ id: "b", prompt: "" })]
    const batch = evaluateRunsCompliance(runs, policy)
    expect(batch.totalRuns).toBe(2)
    expect(batch.compliantRuns).toBe(1)
    expect(batch.reports).toHaveLength(2)
  })
})
