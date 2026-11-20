// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest"

import { applyForAffiliate, clearAffiliateStoreForTests } from "./affiliate"
import { approveCommission, clearCommissionsForTests, recordCommission } from "./commissions"
import {
  COMPLIANCE_CASES_STORE_MAX,
  COMPLIANCE_NOTE_BODY_MAX,
  COMPLIANCE_NOTES_PER_CASE_MAX,
  ComplianceError,
  addNote,
  clearComplianceStoreForTests,
  complianceStats,
  createCase,
  generateAuditTrailCsv,
  generateProgramComplianceReport,
  getCase,
  listCases,
  resetComplianceStoreForTests,
  transitionCase,
} from "./compliance"
import {
  addItemToRun,
  createPayoutRun,
  processRun,
  resetPayoutsForTests,
  upsertPayoutSettings,
} from "./payouts"
import { addReferralRecord, clearReferralFraudStoreForTests, scanReferrals } from "./referral-fraud"
import { resetTaxFormsForTests } from "./tax-forms"

beforeEach(() => {
  clearComplianceStoreForTests()
  clearAffiliateStoreForTests()
  clearCommissionsForTests()
  resetPayoutsForTests()
  clearReferralFraudStoreForTests()
  resetTaxFormsForTests()
})

function openCase(overrides: Partial<Parameters<typeof createCase>[0]> = {}) {
  return createCase({
    type: "fraud_review",
    subjectType: "affiliate",
    subjectId: "aff_1",
    ...overrides,
  })
}

describe("createCase", () => {
  it("creates an open medium-priority case", () => {
    const record = openCase()
    expect(record.id).toMatch(/^ccase_/)
    expect(record.status).toBe("open")
    expect(record.priority).toBe("medium")
    expect(record.notes).toEqual([])
    expect(record.createdAt).toBeTruthy()
    expect(record.updatedAt).toBeTruthy()
  })

  it("honours an explicit priority and trims subjectId", () => {
    const record = openCase({ priority: "high", subjectId: "  user_9  " })
    expect(record.priority).toBe("high")
    expect(record.subjectId).toBe("user_9")
  })

  it("rejects invalid type, subjectType, priority, and empty subjectId", () => {
    expect(() =>
      createCase({ type: "bogus" as never, subjectType: "user", subjectId: "u1" }),
    ).toThrow(ComplianceError)
    expect(() =>
      createCase({ type: "kyc", subjectType: "bogus" as never, subjectId: "u1" }),
    ).toThrow(ComplianceError)
    expect(() =>
      createCase({
        type: "kyc",
        subjectType: "user",
        subjectId: "u1",
        priority: "urgent" as never,
      }),
    ).toThrow(ComplianceError)
    expect(() => createCase({ type: "kyc", subjectType: "user", subjectId: "   " })).toThrow(
      ComplianceError,
    )
  })

  it("enforces the store bound", () => {
    for (let i = 0; i < COMPLIANCE_CASES_STORE_MAX; i += 1) {
      openCase({ subjectId: `s${i}` })
    }
    expect(() => openCase({ subjectId: "overflow" })).toThrowError(
      expect.objectContaining({ code: "capacity" }),
    )
  })
})

describe("addNote", () => {
  it("appends notes with actor and timestamp", () => {
    const record = openCase()
    const updated = addNote(record.id, "admin@example.com", "First note.")
    expect(updated.notes).toHaveLength(1)
    expect(updated.notes[0]).toMatchObject({
      kind: "note",
      actorId: "admin@example.com",
      body: "First note.",
    })
    expect(updated.notes[0].at).toBeTruthy()
    expect(updated.notes[0].id).toMatch(/^cnote_/)
  })

  it("is append-only: earlier notes are preserved and returned copies cannot mutate the store", () => {
    const record = openCase()
    addNote(record.id, "a@x.com", "one")
    const second = addNote(record.id, "b@x.com", "two")
    expect(second.notes.map((n) => n.body)).toEqual(["one", "two"])

    // Mutating a returned copy must not affect the store.
    second.notes[0].body = "tampered"
    second.notes.push({ id: "x", kind: "note", actorId: "x", body: "x", at: "x" })
    const fresh = getCase(record.id)
    expect(fresh?.notes).toHaveLength(2)
    expect(fresh?.notes[0].body).toBe("one")
  })

  it("rejects empty and oversized bodies", () => {
    const record = openCase()
    expect(() => addNote(record.id, "a@x.com", "   ")).toThrow(ComplianceError)
    expect(() => addNote(record.id, "a@x.com", "x".repeat(COMPLIANCE_NOTE_BODY_MAX + 1))).toThrow(
      ComplianceError,
    )
  })

  it("throws not_found for unknown cases", () => {
    expect(() => addNote("ccase_missing", "a@x.com", "hi")).toThrowError(
      expect.objectContaining({ code: "not_found" }),
    )
  })
})

describe("transitionCase", () => {
  it("walks open → investigating → resolved and stamps resolvedAt", () => {
    const record = openCase()
    const investigating = transitionCase(record.id, "investigating", {
      actorId: "admin@example.com",
    })
    expect(investigating.status).toBe("investigating")
    expect(investigating.resolvedAt).toBeUndefined()
    // Transition is recorded in the append-only log.
    expect(investigating.notes.at(-1)).toMatchObject({
      kind: "transition",
      actorId: "admin@example.com",
    })
    expect(investigating.notes.at(-1)?.body).toContain('"open" to "investigating"')

    const resolved = transitionCase(record.id, "resolved")
    expect(resolved.status).toBe("resolved")
    expect(resolved.resolvedAt).toBeTruthy()
  })

  it("supports dismissal from investigating", () => {
    const record = openCase()
    transitionCase(record.id, "investigating")
    const dismissed = transitionCase(record.id, "dismissed", { note: "Not a violation." })
    expect(dismissed.status).toBe("dismissed")
    expect(dismissed.resolvedAt).toBeUndefined()
    expect(dismissed.notes.at(-1)?.body).toContain("Not a violation.")
  })

  it("rejects illegal transitions", () => {
    const record = openCase()
    // open cannot skip investigating or jump straight to a terminal state.
    expect(() => transitionCase(record.id, "resolved")).toThrowError(
      expect.objectContaining({ code: "invalid_transition" }),
    )
    expect(() => transitionCase(record.id, "dismissed")).toThrowError(
      expect.objectContaining({ code: "invalid_transition" }),
    )
    transitionCase(record.id, "investigating")
    transitionCase(record.id, "resolved")
    // Terminal states accept nothing.
    expect(() => transitionCase(record.id, "investigating")).toThrowError(
      expect.objectContaining({ code: "invalid_transition" }),
    )
    expect(() => transitionCase(record.id, "dismissed")).toThrowError(
      expect.objectContaining({ code: "invalid_transition" }),
    )
  })

  it("throws not_found for unknown cases", () => {
    expect(() => transitionCase("ccase_missing", "investigating")).toThrowError(
      expect.objectContaining({ code: "not_found" }),
    )
  })

  it("validates the embedded note like addNote (trim, non-empty, max length)", () => {
    const record = openCase()
    expect(() => transitionCase(record.id, "investigating", { note: "   " })).toThrowError(
      expect.objectContaining({ code: "invalid_input" }),
    )
    expect(() =>
      transitionCase(record.id, "investigating", {
        note: "x".repeat(COMPLIANCE_NOTE_BODY_MAX + 1),
      }),
    ).toThrowError(expect.objectContaining({ code: "invalid_input" }))
    // Failed validation must not have moved the case.
    expect(getCase(record.id)?.status).toBe("open")

    const updated = transitionCase(record.id, "investigating", {
      note: "  looked into it  ",
    })
    expect(updated.notes.at(-1)?.body).toContain("looked into it")
    expect(updated.notes.at(-1)?.body).not.toContain("  looked")
  })

  it("leaves the case untouched when the note log is at capacity", () => {
    const record = openCase()
    // Fill the append-only log to COMPLIANCE_NOTES_PER_CASE_MAX.
    for (let i = 0; i < COMPLIANCE_NOTES_PER_CASE_MAX; i += 1) {
      addNote(record.id, "admin@x.com", `note ${i}`)
    }
    expect(getCase(record.id)?.notes).toHaveLength(COMPLIANCE_NOTES_PER_CASE_MAX)

    // The transition note cannot be appended — the status must NOT change,
    // otherwise the case would transition without an audit entry and a
    // retry would fail with invalid_transition instead of capacity.
    expect(() => transitionCase(record.id, "investigating")).toThrowError(
      expect.objectContaining({ code: "capacity" }),
    )
    const after = getCase(record.id)
    expect(after?.status).toBe("open")
    expect(after?.notes).toHaveLength(COMPLIANCE_NOTES_PER_CASE_MAX)
    expect(after?.notes.at(-1)?.kind).toBe("note")
    // The state machine is intact: open → resolved is still illegal.
    expect(() => transitionCase(record.id, "resolved")).toThrowError(
      expect.objectContaining({ code: "invalid_transition" }),
    )
  })
})

describe("listCases / getCase / complianceStats", () => {
  it("filters by status, type, priority, subjectType, and subjectId", () => {
    const a = openCase({ type: "fraud_review", priority: "high", subjectId: "aff_a" })
    const b = openCase({ type: "kyc", priority: "low", subjectType: "partner", subjectId: "aff_b" })
    transitionCase(a.id, "investigating")
    transitionCase(a.id, "resolved")

    expect(listCases({ status: "resolved" }).items.map((c) => c.id)).toEqual([a.id])
    expect(listCases({ status: "open" }).items.map((c) => c.id)).toEqual([b.id])
    expect(listCases({ type: "kyc" }).total).toBe(1)
    expect(listCases({ priority: "high" }).total).toBe(1)
    expect(listCases({ subjectType: "partner" }).items[0].id).toBe(b.id)
    expect(listCases({ subjectId: "aff_a" }).items[0].id).toBe(a.id)
    expect(getCase(a.id)?.status).toBe("resolved")
    expect(getCase("nope")).toBeNull()
  })

  it("orders newest first and paginates", () => {
    const first = openCase({ subjectId: "s1" })
    const second = openCase({ subjectId: "s2" })
    const page = listCases({ limit: 1, offset: 1 })
    expect(page.total).toBe(2)
    expect(page.items).toHaveLength(1)
    expect(page.items[0].id).toBe(first.id)
    expect(second.id).not.toBe(first.id)
  })

  it("complianceStats aggregates statuses, open cases by type/priority, and notes", () => {
    const a = openCase({ type: "fraud_review", priority: "high" })
    openCase({ type: "kyc", priority: "low", subjectType: "user", subjectId: "u1" })
    addNote(a.id, "admin@x.com", "note")
    transitionCase(a.id, "investigating")

    const stats = complianceStats()
    expect(stats.cases.total).toBe(2)
    expect(stats.cases.open).toBe(1)
    expect(stats.cases.investigating).toBe(1)
    // openBy* covers open + investigating cases.
    expect(stats.openByType).toEqual({ fraud_review: 1, kyc: 1 })
    expect(stats.openByPriority).toEqual({ high: 1, low: 1 })
    expect(stats.notesTotal).toBe(2) // admin note + transition entry
  })
})

describe("generateProgramComplianceReport", () => {
  it("aggregates affiliates, cases, fraud flags, commissions, payouts, and tax forms", () => {
    const affiliate = applyForAffiliate("user-1", "aff@example.com")
    const commission = recordCommission({ affiliateId: affiliate.id, amountCents: 1_000 })
    approveCommission(commission.id)
    upsertPayoutSettings(affiliate.id, { method: "manual" })
    const run = createPayoutRun({
      periodStart: "2025-01-01T00:00:00.000Z",
      periodEnd: "2025-02-01T00:00:00.000Z",
    })
    addItemToRun(run.id, { affiliateId: affiliate.id, amountCents: 500 })
    processRun(run.id)

    // Fraud flag: identical referrer/referred emails score 50 ≥ threshold.
    addReferralRecord({
      id: "ref_1",
      referrerEmail: "same@example.com",
      referredEmail: "same@example.com",
      createdAt: new Date().toISOString(),
    })
    scanReferrals()

    const caseRecord = openCase({ type: "payout_hold", subjectId: affiliate.id })
    addNote(caseRecord.id, "admin@x.com", "hold payout")

    const report = generateProgramComplianceReport()
    expect(report.affiliates.total).toBe(1)
    expect(report.affiliates.byStatus.pending).toBe(1)
    expect(report.cases.total).toBe(1)
    expect(report.cases.byStatus.open).toBe(1)
    expect(report.cases.openByType).toEqual({ payout_hold: 1 })
    expect(report.cases.openByPriority).toEqual({ medium: 1 })
    expect(report.fraudFlags.byStatus.pending).toBe(1)
    expect(report.commissions.total).toBe(1)
    expect(report.commissions.amountCentsByStatus.approved).toBe(1_000)
    expect(report.payouts.runsTotal).toBe(1)
    expect(report.payouts.itemsTotal).toBe(1)
    // Item failed? method "manual" is configured → paid.
    expect(report.payouts.itemsAmountCentsByStatus.paid).toBe(500)
  })

  it("counts every fraud flag, not just the first 500-item page", () => {
    // listFlags clamps each page to 500 while the flag store holds up to
    // 2,000 — the report must paginate through all of them.
    for (let i = 0; i < 600; i += 1) {
      addReferralRecord({
        id: `ref_page_${i}`,
        referrerEmail: `self${i}@example.com`,
        referredEmail: `self${i}@example.com`,
        createdAt: new Date().toISOString(),
      })
    }
    scanReferrals()

    const report = generateProgramComplianceReport()
    expect(report.fraudFlags.total).toBe(600)
    expect(report.fraudFlags.byStatus.pending).toBe(600)
    expect(report.fraudFlags.scannedInPeriod).toBe(600)
  })

  it("filters period-scoped aggregates by start inclusive / end exclusive", () => {
    const affiliate = applyForAffiliate("user-1", "aff@example.com")
    recordCommission({ affiliateId: affiliate.id, amountCents: 2_000 })
    openCase({ subjectId: affiliate.id })

    const report = generateProgramComplianceReport({
      period: { start: "2000-01-01T00:00:00.000Z", end: "2000-02-01T00:00:00.000Z" },
    })
    expect(report.cases.createdInPeriod).toBe(0)
    expect(report.commissions.createdInPeriod).toBe(0)
    expect(report.commissions.amountCentsByStatus).toEqual({})
    // All-time buckets are unaffected.
    expect(report.cases.total).toBe(1)
    expect(report.commissions.total).toBe(1)

    const everything = generateProgramComplianceReport({
      period: { start: "2000-01-01T00:00:00.000Z", end: "2999-01-01T00:00:00.000Z" },
    })
    expect(everything.cases.createdInPeriod).toBe(1)
    expect(everything.commissions.amountCentsByStatus.pending).toBe(2_000)
  })

  it("rejects invalid periods", () => {
    expect(() => generateProgramComplianceReport({ period: { start: "not-a-date" } })).toThrow(
      ComplianceError,
    )
    expect(() =>
      generateProgramComplianceReport({
        period: { start: "2025-02-01", end: "2025-01-01" },
      }),
    ).toThrow(ComplianceError)
  })
})

describe("generateAuditTrailCsv", () => {
  it("exports note and transition rows with escaping", () => {
    const record = openCase({
      type: "policy_violation",
      subjectId: 'subj,"with"\\comma\nand newline',
    })
    addNote(record.id, "admin@x.com", 'note with "quotes", commas, and\nnewlines')
    transitionCase(record.id, "investigating", { actorId: "admin@x.com" })

    const csv = generateAuditTrailCsv({ caseId: record.id })
    const lines = csv.trimEnd().split("\r\n")
    expect(lines[0]).toBe(
      "timestamp,actor_id,event,case_id,case_type,case_status,priority,subject_type,subject_id,note",
    )
    // 1 note + 1 transition = 2 rows (order between same-ms entries is by id).
    expect(lines).toHaveLength(3)
    expect(csv).toContain('"note with ""quotes"", commas, and\nnewlines"')
    expect(csv).toContain(",transition,")
    // Subject id containing a comma/quote/newline is quoted.
    expect(csv).toContain('"subj,""with""\\comma\nand newline"')
  })

  it("filters by period and scopes to a case", () => {
    const a = openCase({ subjectId: "a" })
    const b = openCase({ subjectId: "b" })
    addNote(a.id, "admin@x.com", "alpha")
    addNote(b.id, "admin@x.com", "beta")

    const all = generateAuditTrailCsv()
    expect(all.trimEnd().split("\r\n")).toHaveLength(3) // header + 2 notes

    const onlyA = generateAuditTrailCsv({ caseId: a.id })
    expect(onlyA).toContain("alpha")
    expect(onlyA).not.toContain("beta")

    const future = generateAuditTrailCsv({
      period: { start: "2999-01-01T00:00:00.000Z" },
    })
    expect(future.trimEnd().split("\r\n")).toHaveLength(1) // header only
  })

  it("neutralizes spreadsheet formula-leading characters in cells", () => {
    const record = openCase({ subjectId: "=HYPERLINK()" })
    addNote(record.id, "admin@x.com", "=cmd|'/c calc'!A0")
    addNote(record.id, "admin@x.com", "+1+1")

    const csv = generateAuditTrailCsv({ caseId: record.id })
    expect(csv).toContain("'=HYPERLINK()")
    expect(csv).toContain("'=cmd|'/c calc'!A0")
    expect(csv).toContain("'+1+1")
    // No cell may begin with a bare formula trigger.
    for (const line of csv.trimEnd().split("\r\n").slice(1)) {
      for (const cell of line.split(",")) {
        expect(cell.startsWith("=")).toBe(false)
        expect(cell.startsWith("+")).toBe(false)
        expect(cell.startsWith("-")).toBe(false)
        expect(cell.startsWith("@")).toBe(false)
      }
    }
  })

  it("throws not_found for an unknown caseId", () => {
    expect(() => generateAuditTrailCsv({ caseId: "ccase_missing" })).toThrowError(
      expect.objectContaining({ code: "not_found" }),
    )
  })
})

describe("resetComplianceStoreForTests", () => {
  it("clears cases (alias of clearComplianceStoreForTests)", () => {
    openCase()
    expect(listCases().total).toBe(1)
    resetComplianceStoreForTests()
    expect(listCases().total).toBe(0)
  })
})
