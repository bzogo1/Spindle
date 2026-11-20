// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

import { applyForAffiliate, clearAffiliateStoreForTests } from "./affiliate"
import { approveCommission, recordCommission, resetCommissionsForTests } from "./commissions"
import {
  addItemToRun,
  createPayoutRun,
  getRun,
  processRun,
  resetPayoutsForTests,
  upsertPayoutSettings,
} from "./payouts"
import {
  TAX_FORMS_STORE_MAX,
  TAX_FORM_STATUSES,
  TAX_FORM_TYPES,
  TAX_YEAR_MAX,
  TAX_YEAR_MIN,
  TaxFormNotFoundError,
  TaxFormTransitionError,
  TaxFormValidationError,
  W9_TAX_CLASSIFICATIONS,
  exportTaxSummaryCsv,
  generate1099Data,
  generate1099ForAffiliate,
  generateW9Draft,
  getTaxForm,
  listTaxForms,
  markTaxFormOnFile,
  resetTaxFormsForTests,
  submitW9,
} from "./tax-forms"

const YEAR = new Date().getUTCFullYear()

function makeAffiliate(email = "partner@example.com") {
  return applyForAffiliate(`user_${email}`, email)
}

/** Drives one approved commission through a simulated payout run to `paid`. */
function payOut(affiliateId: string, amountCents: number) {
  upsertPayoutSettings(affiliateId, { method: "manual" })
  const commission = recordCommission({ affiliateId, amountCents })
  approveCommission(commission.id)
  const run = createPayoutRun({
    periodStart: `${YEAR}-01-01`,
    periodEnd: `${YEAR + 1}-01-01`,
  })
  addItemToRun(run.id, { affiliateId, amountCents, commissionIds: [commission.id] })
  processRun(run.id)
}

beforeEach(() => {
  resetTaxFormsForTests()
  resetPayoutsForTests()
  resetCommissionsForTests()
  clearAffiliateStoreForTests()
})

describe("generate1099Data", () => {
  it("aggregates paid payout items for the affiliate in the tax year", () => {
    const affiliate = makeAffiliate()
    payOut(affiliate.id, 10_000)
    payOut(affiliate.id, 2_500)

    const data = generate1099Data(affiliate.id, YEAR)
    expect(data).toEqual({
      affiliateId: affiliate.id,
      year: YEAR,
      totalPaidCents: 12_500,
      formType: "1099-NEC",
    })
  })

  it("excludes other affiliates, pending items, and other years", () => {
    const affiliate = makeAffiliate()
    const other = makeAffiliate("other@example.com")
    payOut(affiliate.id, 10_000)
    payOut(other.id, 99_999)

    // A pending (unprocessed) run contributes nothing.
    upsertPayoutSettings(affiliate.id, { method: "manual" })
    const commission = recordCommission({ affiliateId: affiliate.id, amountCents: 5_000 })
    approveCommission(commission.id)
    const draft = createPayoutRun({ periodStart: `${YEAR}-01-01`, periodEnd: `${YEAR + 1}-01-01` })
    addItemToRun(draft.id, {
      affiliateId: affiliate.id,
      amountCents: 5_000,
      commissionIds: [commission.id],
    })

    expect(generate1099Data(affiliate.id, YEAR).totalPaidCents).toBe(10_000)
    expect(generate1099Data(affiliate.id, YEAR - 1).totalPaidCents).toBe(0)
    // Out-of-range years are rejected rather than silently returning zero.
    expect(() => generate1099Data(affiliate.id, TAX_YEAR_MIN - 1)).toThrow(TaxFormValidationError)
  })

  it("returns zero totals for an affiliate with no payouts", () => {
    const affiliate = makeAffiliate()
    expect(generate1099Data(affiliate.id, YEAR).totalPaidCents).toBe(0)
  })

  it("attributes payments by per-item paidAt, surviving a failed-run retry across years", () => {
    vi.useFakeTimers()
    try {
      const paidEarly = makeAffiliate("early@example.com")
      const paidLate = makeAffiliate("late@example.com")
      upsertPayoutSettings(paidEarly.id, { method: "manual" })

      // One run, two affiliates: early pays in December, late has no payout
      // method yet so the run fails and is retried in January.
      const run = createPayoutRun({
        periodStart: "2024-12-01",
        periodEnd: "2025-01-15",
      })
      addItemToRun(run.id, { affiliateId: paidEarly.id, amountCents: 4_000 })
      addItemToRun(run.id, { affiliateId: paidLate.id, amountCents: 6_000 })

      vi.setSystemTime(new Date("2024-12-31T12:00:00.000Z"))
      processRun(run.id)
      expect(getRun(run.id)?.run.status).toBe("failed")

      // Retry in January overwrites run.completedAt — but the December
      // payment must still report in tax year 2024.
      vi.setSystemTime(new Date("2025-01-05T12:00:00.000Z"))
      upsertPayoutSettings(paidLate.id, { method: "manual" })
      processRun(run.id)
      expect(getRun(run.id)?.run.status).toBe("completed")
      expect(getRun(run.id)?.run.completedAt).toBe("2025-01-05T12:00:00.000Z")

      expect(generate1099Data(paidEarly.id, 2024).totalPaidCents).toBe(4_000)
      expect(generate1099Data(paidEarly.id, 2025).totalPaidCents).toBe(0)
      expect(generate1099Data(paidLate.id, 2025).totalPaidCents).toBe(6_000)
      expect(generate1099Data(paidLate.id, 2024).totalPaidCents).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it("uses the UTC year of paidAt at the tax-year boundary", () => {
    vi.useFakeTimers()
    try {
      const before = makeAffiliate("before@example.com")
      const after = makeAffiliate("after@example.com")
      upsertPayoutSettings(before.id, { method: "manual" })
      upsertPayoutSettings(after.id, { method: "manual" })

      // 23:30 UTC on Dec 31 is still tax year 2024 regardless of server TZ.
      vi.setSystemTime(new Date("2024-12-31T23:30:00.000Z"))
      const runA = createPayoutRun({ periodStart: "2024-12-01", periodEnd: "2025-01-15" })
      addItemToRun(runA.id, { affiliateId: before.id, amountCents: 1_000 })
      processRun(runA.id)

      // 00:30 UTC on Jan 1 belongs to tax year 2025.
      vi.setSystemTime(new Date("2025-01-01T00:30:00.000Z"))
      const runB = createPayoutRun({ periodStart: "2024-12-01", periodEnd: "2025-01-15" })
      addItemToRun(runB.id, { affiliateId: after.id, amountCents: 2_000 })
      processRun(runB.id)

      expect(generate1099Data(before.id, 2024).totalPaidCents).toBe(1_000)
      expect(generate1099Data(before.id, 2025).totalPaidCents).toBe(0)
      expect(generate1099Data(after.id, 2025).totalPaidCents).toBe(2_000)
      expect(generate1099Data(after.id, 2024).totalPaidCents).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it("rejects unknown affiliates and out-of-range years", () => {
    const affiliate = makeAffiliate()
    expect(() => generate1099Data("aff_missing", YEAR)).toThrow(TaxFormNotFoundError)
    expect(() => generate1099Data(affiliate.id, TAX_YEAR_MIN - 1)).toThrow(TaxFormValidationError)
    expect(() => generate1099Data(affiliate.id, TAX_YEAR_MAX + 1)).toThrow(TaxFormValidationError)
    expect(() => generate1099Data(affiliate.id, 2020.5)).toThrow(TaxFormValidationError)
  })
})

describe("generateW9Draft", () => {
  it("defaults name to the account email and classification to individual", () => {
    const affiliate = makeAffiliate()
    const draft = generateW9Draft(affiliate.id)
    expect(draft).toEqual({
      affiliateId: affiliate.id,
      name: "partner@example.com",
      taxClassification: "individual",
      tinProvided: false,
    })
    expect(draft).not.toHaveProperty("tin")
    expect(draft).not.toHaveProperty("ssn")
    expect(draft).not.toHaveProperty("ein")
  })

  it("reflects stored details after submitW9 and never exposes a TIN", () => {
    const affiliate = makeAffiliate()
    submitW9(affiliate.id, {
      name: "Ada Lovelace",
      businessName: "Analytical Engines LLC",
      taxClassification: "llc",
      tinProvided: true,
    })
    const draft = generateW9Draft(affiliate.id)
    expect(draft.name).toBe("Ada Lovelace")
    expect(draft.businessName).toBe("Analytical Engines LLC")
    expect(draft.taxClassification).toBe("llc")
    expect(draft.tinProvided).toBe(true)
    // The serialized draft must not contain anything TIN-shaped.
    expect(JSON.stringify(draft)).not.toMatch(/\b\d{3}-\d{2}-\d{4}\b/)
  })

  it("throws for unknown affiliates", () => {
    expect(() => generateW9Draft("aff_missing")).toThrow(TaxFormNotFoundError)
  })
})

describe("submitW9", () => {
  it("upserts a single w9 record per affiliate with submitted status", () => {
    const affiliate = makeAffiliate()
    const first = submitW9(affiliate.id, { name: "Ada" })
    const second = submitW9(affiliate.id, { name: "Ada Byron", tinProvided: true })

    expect(second.id).toBe(first.id)
    expect(second.status).toBe("submitted")
    expect(listTaxForms({ affiliateId: affiliate.id, formType: "w9" })).toHaveLength(1)

    // Partial update keeps previously stored fields.
    const draft = generateW9Draft(affiliate.id)
    expect(draft.name).toBe("Ada Byron")
    expect(draft.tinProvided).toBe(true)
  })

  it("keeps an on_file record on_file while still updating details", () => {
    const affiliate = makeAffiliate()
    const record = submitW9(affiliate.id, { name: "Ada" })
    markTaxFormOnFile(record.id)
    const resubmitted = submitW9(affiliate.id, { businessName: "Engines" })
    expect(resubmitted.status).toBe("on_file")
    expect(generateW9Draft(affiliate.id).businessName).toBe("Engines")
  })

  it("rejects invalid classifications and oversized names", () => {
    const affiliate = makeAffiliate()
    expect(() => submitW9(affiliate.id, { taxClassification: "trust" as never })).toThrow(
      TaxFormValidationError,
    )
    expect(() => submitW9(affiliate.id, { name: "x".repeat(201) })).toThrow(TaxFormValidationError)
  })

  it("rejects TIN-shaped values smuggled into name and businessName", () => {
    const affiliate = makeAffiliate()
    const tinShaped = [
      "123-45-6789", // SSN
      "911-11-1111", // ITIN-shaped (also matches the SSN pattern)
      "12-3456789", // EIN
      "123456789", // bare 9-digit TIN
      "Contact me at 123-45-6789 please", // embedded, not just whole-field
      // Word-boundary bypasses — must be rejected even glued to letters.
      "SSN123-45-6789",
      "123-45-6789x",
      "abc123456789def",
      // Spaced / dotted variants.
      "123 45 6789",
      "123.45.6789",
      "12 3456789",
    ]
    for (const bad of tinShaped) {
      expect(() => submitW9(affiliate.id, { name: bad })).toThrow(TaxFormValidationError)
      expect(() => submitW9(affiliate.id, { businessName: bad })).toThrow(TaxFormValidationError)
    }
    // Rejections must not persist anything — the draft stays TIN-free.
    const draft = generateW9Draft(affiliate.id)
    expect(draft.name).toBe("partner@example.com")
    expect(draft.businessName).toBeUndefined()
    expect(JSON.stringify(draft)).not.toMatch(/\d{3}[-.\s]?\d{2}[-.\s]?\d{4}|\d{2}[-.\s]?\d{7}/)
  })

  it("still accepts ordinary names that merely contain digits", () => {
    const affiliate = makeAffiliate()
    const record = submitW9(affiliate.id, {
      name: "John Smith",
      businessName: "Acme 2024 LLC",
    })
    expect(record.status).toBe("submitted")
    const draft = generateW9Draft(affiliate.id)
    expect(draft.name).toBe("John Smith")
    expect(draft.businessName).toBe("Acme 2024 LLC")
  })
})

describe("generate1099ForAffiliate", () => {
  it("creates a draft 1099-nec record and upserts per affiliate+year", () => {
    const affiliate = makeAffiliate()
    payOut(affiliate.id, 7_500)

    const first = generate1099ForAffiliate(affiliate.id, YEAR)
    expect(first.record.formType).toBe("1099-nec")
    expect(first.record.year).toBe(YEAR)
    expect(first.record.status).toBe("draft")
    expect(first.data.totalPaidCents).toBe(7_500)

    const second = generate1099ForAffiliate(affiliate.id, YEAR)
    expect(second.record.id).toBe(first.record.id)
    expect(listTaxForms({ affiliateId: affiliate.id, formType: "1099-nec" })).toHaveLength(1)

    // A different year is a separate record.
    const other = generate1099ForAffiliate(affiliate.id, YEAR - 1)
    expect(other.record.id).not.toBe(first.record.id)
    expect(other.data.totalPaidCents).toBe(0)
  })

  it("keeps an on_file 1099 on_file when regenerated", () => {
    const affiliate = makeAffiliate()
    const { record } = generate1099ForAffiliate(affiliate.id, YEAR)
    markTaxFormOnFile(record.id)
    const regenerated = generate1099ForAffiliate(affiliate.id, YEAR)
    expect(regenerated.record.status).toBe("on_file")
  })
})

describe("markTaxFormOnFile", () => {
  it("transitions draft|submitted → on_file and rejects on_file → on_file", () => {
    const affiliate = makeAffiliate()
    const w9 = submitW9(affiliate.id)
    expect(w9.status).toBe("submitted")

    const filed = markTaxFormOnFile(w9.id)
    expect(filed?.status).toBe("on_file")
    expect(() => markTaxFormOnFile(w9.id)).toThrow(TaxFormTransitionError)
    expect(markTaxFormOnFile("txf_missing")).toBeNull()
  })
})

describe("listTaxForms / getTaxForm", () => {
  it("filters by affiliateId, formType, year, and status", () => {
    const affiliate = makeAffiliate()
    const other = makeAffiliate("other@example.com")
    submitW9(affiliate.id)
    generate1099ForAffiliate(affiliate.id, YEAR)
    generate1099ForAffiliate(other.id, YEAR)

    expect(listTaxForms({ affiliateId: affiliate.id })).toHaveLength(2)
    expect(listTaxForms({ formType: "w9" })).toHaveLength(1)
    expect(listTaxForms({ year: YEAR })).toHaveLength(2)
    expect(listTaxForms({ status: "submitted" })).toHaveLength(1)
    expect(getTaxForm("txf_missing")).toBeNull()
  })
})

describe("exportTaxSummaryCsv", () => {
  it("emits a header plus one row per affiliate with paid totals", () => {
    const affiliate = makeAffiliate()
    payOut(affiliate.id, 12_345)
    makeAffiliate("zero@example.com")

    const csv = exportTaxSummaryCsv(YEAR)
    const lines = csv.trimEnd().split("\r\n")
    expect(lines[0]).toBe("affiliate_id,email,year,total_paid_cents,currency,form_type")
    expect(lines).toHaveLength(3)
    const row = lines.find((line) => line.includes(affiliate.id))
    expect(row).toBe(`${affiliate.id},partner@example.com,${YEAR},12345,USD,1099-NEC`)
    expect(csv).toContain(`zero@example.com,${YEAR},0,USD,1099-NEC`)
  })

  it("escapes commas, quotes, and newlines in fields", () => {
    // Emails are normalized lowercase but may legitimately contain commas
    // only via crafted input — applyForAffiliate does not restrict them, so
    // craft an account directly through the public API.
    const tricky = applyForAffiliate("user_tricky", 'weird,"name"@example.com')
    const csv = exportTaxSummaryCsv(YEAR)
    const row = csv.split("\r\n").find((line) => line.includes(tricky.id))
    expect(row).toBeDefined()
    expect(row).toContain('"weird,""name""@example.com"')
  })

  it("neutralizes spreadsheet formula-leading characters in the email column", () => {
    // applyForAffiliate only requires a plausible address, so an email local
    // part may legitimately begin with =, +, -, or @ — all formula triggers.
    for (const prefix of ["=", "+", "-"]) {
      applyForAffiliate(`user_${prefix}`, `${prefix}formula@example.com`)
    }
    const csv = exportTaxSummaryCsv(YEAR)
    for (const prefix of ["=", "+", "-"]) {
      expect(csv).toContain(`'${prefix}formula@example.com`)
    }
    // The dangerous leading char must be quote-prefixed, never bare.
    expect(csv).not.toMatch(/(^|,)[=+\-@]formula@example\.com/m)
  })

  it("rejects out-of-range years", () => {
    expect(() => exportTaxSummaryCsv(TAX_YEAR_MAX + 1)).toThrow(TaxFormValidationError)
  })
})

describe("bounds and constants", () => {
  it("exposes the documented status/type sets and store bound", () => {
    expect(TAX_FORM_TYPES).toEqual(["w9", "1099-nec"])
    expect(TAX_FORM_STATUSES).toEqual(["draft", "submitted", "on_file"])
    expect(W9_TAX_CLASSIFICATIONS).toContain("s_corp")
    expect(TAX_FORMS_STORE_MAX).toBeGreaterThan(0)
  })

  it("enforces the store bound", () => {
    // 20 affiliates × 101 valid years = 2020 potential records > bound (2000).
    const affiliates = Array.from({ length: 20 }, (_, i) => makeAffiliate(`bound${i}@example.com`))
    let threw = false
    try {
      for (const affiliate of affiliates) {
        for (let year = TAX_YEAR_MIN; year <= TAX_YEAR_MAX; year += 1) {
          generate1099ForAffiliate(affiliate.id, year)
        }
      }
    } catch (error) {
      threw = true
      expect(error).toBeInstanceOf(TaxFormValidationError)
      expect((error as Error).message).toMatch(/capacity/)
    }
    expect(threw).toBe(true)
    expect(listTaxForms()).toHaveLength(TAX_FORMS_STORE_MAX)
  })
})
