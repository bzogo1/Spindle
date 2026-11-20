/**
 * Tax form scaffolding for affiliates/partners — SIMULATED GENERATION ONLY.
 *
 * DEVELOPMENT SEAM: state lives in process-local `Map`s, the same
 * interim-store pattern as `affiliate.ts` / `commissions.ts` /
 * `payouts.ts`. On serverless or multi-instance deploys each instance keeps
 * its own copy — tax form records and W-9 details are lost on restart and
 * are not shared between instances. The upgrade path is `TaxFormRecord` /
 * `AffiliateW9Details` tables; the exported function signatures are already
 * shaped for that swap.
 *
 * NO REAL IRS FILING. `generate1099Data` produces a SIMULATED aggregate of
 * paid payout totals for reporting scaffolding only — there is no e-file,
 * no IRS transmitter integration, and no generated PDF. `generateW9Draft`
 * produces a draft object the partner completes through a real form; the
 * TIN itself is NEVER accepted, stored, or returned — only the boolean
 * `tinProvided` flag survives. W-9 details that are stored (legal name,
 * business name, tax classification) are non-sensitive labels.
 *
 * PAID-TOTAL SOURCE: `totalPaidCents` sums payout items with
 * `status: "paid"` attributed by the item's own `paidAt` timestamp (falling
 * back to the run's `completedAt` for items predating that field) whose
 * UTC year matches the tax year — i.e. simulated disbursements. Per-item
 * attribution matters because `processRun` overwrites `run.completedAt` on
 * a failed-run retry: a payment made in December must stay in the December
 * tax year even if the run is retried in January. Commission ledger records
 * marked `paid` are bookkeeping only and are deliberately NOT counted here
 * to avoid double counting against payout items (the two ledgers are not
 * yet reconciled — see `src/lib/payouts.ts`).
 *
 * Server-only in practice: imported by route handlers and tests; client
 * components must not import it.
 */

import { listAffiliates, type AffiliateAccount } from "./affiliate"
import { getRun, listRuns } from "./payouts"

export type TaxFormType = "w9" | "1099-nec"
export const TAX_FORM_TYPES: readonly TaxFormType[] = ["w9", "1099-nec"]

export type TaxFormStatus = "draft" | "submitted" | "on_file"
export const TAX_FORM_STATUSES: readonly TaxFormStatus[] = ["draft", "submitted", "on_file"]

/**
 * A tax form record. Uniqueness is enforced by upsert semantics:
 * one `w9` per affiliate, one `1099-nec` per affiliate+year.
 * `year` is present only for `1099-nec` records.
 */
export interface TaxFormRecord {
  id: string
  affiliateId: string
  formType: TaxFormType
  year?: number
  status: TaxFormStatus
  /** ISO timestamp — record creation time. */
  createdAt: string
  /** ISO timestamp — last status/upsert transition. */
  updatedAt: string
}

export type W9TaxClassification =
  "individual" | "llc" | "s_corp" | "c_corp" | "partnership" | "other"

export const W9_TAX_CLASSIFICATIONS: readonly W9TaxClassification[] = [
  "individual",
  "llc",
  "s_corp",
  "c_corp",
  "partnership",
  "other",
]

/**
 * Non-sensitive W-9 details a partner may submit. There is deliberately
 * NO field for a TIN/SSN/EIN value — the API schema is strict and rejects
 * unknown keys, and this type has nowhere to put one. `tinProvided` is a
 * boolean flag only.
 */
export interface W9Details {
  /** Legal name as it should appear on the form. Defaults to account email. */
  name: string
  businessName?: string
  taxClassification: W9TaxClassification
  /** Whether the partner says they have a TIN on file. Never the TIN itself. */
  tinProvided: boolean
}

/**
 * The W-9 draft handed to the partner. `name` falls back to the affiliate
 * account's email because `AffiliateAccount` carries no personal name.
 */
export interface W9Draft extends W9Details {
  affiliateId: string
}

/** Simulated 1099-NEC aggregate for one affiliate in one tax year. */
export interface Tax1099Data {
  affiliateId: string
  year: number
  /** Sum of simulated paid payout items whose `paidAt` UTC year is `year`. */
  totalPaidCents: number
  formType: "1099-NEC"
}

/** Hard cap so the in-memory store cannot grow without bound. */
export const TAX_FORMS_STORE_MAX = 2_000
/** Tax years accepted by the generators (inclusive bounds). */
export const TAX_YEAR_MIN = 2000
export const TAX_YEAR_MAX = 2100
const W9_NAME_MAX_LENGTH = 200

const records = new Map<string, TaxFormRecord>() // id → record
const w9DetailsByAffiliate = new Map<string, W9Details>() // affiliateId → details
// Unique-key indexes for upsert semantics.
const w9ByAffiliate = new Map<string, string>() // affiliateId → record id
const necByAffiliateYear = new Map<string, string>() // `${affiliateId}:${year}` → record id

function taxFormId(): string {
  return `txf_${crypto.randomUUID()}`
}

function nowIso(): string {
  return new Date().toISOString()
}

/** Thrown on invalid input (bad year, unknown affiliate, bad W-9 fields). */
export class TaxFormValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "TaxFormValidationError"
  }
}

/** Thrown when a status transition is not allowed (the API answers 409). */
export class TaxFormTransitionError extends Error {
  constructor(
    public readonly action: "file",
    public readonly from: TaxFormStatus,
  ) {
    super(`Cannot ${action} a tax form in status "${from}".`)
    this.name = "TaxFormTransitionError"
  }
}

/** Thrown when an affiliate id does not match an affiliate account. */
export class TaxFormNotFoundError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "TaxFormNotFoundError"
  }
}

function assertAffiliateId(affiliateId: string): string {
  const id = affiliateId.trim()
  if (!id) throw new TaxFormValidationError("An affiliate id is required.")
  return id
}

function assertTaxYear(year: number): number {
  if (!Number.isInteger(year) || year < TAX_YEAR_MIN || year > TAX_YEAR_MAX) {
    throw new TaxFormValidationError(
      `year must be an integer between ${TAX_YEAR_MIN} and ${TAX_YEAR_MAX}.`,
    )
  }
  return year
}

function affiliateById(affiliateId: string): AffiliateAccount {
  const id = assertAffiliateId(affiliateId)
  const account = listAffiliates().find((entry) => entry.id === id)
  if (!account) {
    throw new TaxFormNotFoundError(`affiliateId "${id}" does not match an affiliate account.`)
  }
  return account
}

function upsertRecord(input: {
  affiliateId: string
  formType: TaxFormType
  year?: number
  status: TaxFormStatus
  /** Pre-computed unique key into the matching index map. */
  indexKey: string
  index: Map<string, string>
}): TaxFormRecord {
  const existingId = input.index.get(input.indexKey)
  const existing = existingId ? records.get(existingId) : undefined

  if (existing) {
    existing.status = input.status
    existing.updatedAt = nowIso()
    return existing
  }

  if (records.size >= TAX_FORMS_STORE_MAX) {
    throw new TaxFormValidationError(
      "The tax form store is currently at capacity. Try again later.",
    )
  }

  const at = nowIso()
  const record: TaxFormRecord = {
    id: taxFormId(),
    affiliateId: input.affiliateId,
    formType: input.formType,
    ...(input.year !== undefined ? { year: input.year } : {}),
    status: input.status,
    createdAt: at,
    updatedAt: at,
  }
  records.set(record.id, record)
  if (record.formType === "w9") w9ByAffiliate.set(record.affiliateId, record.id)
  else if (record.year !== undefined) {
    necByAffiliateYear.set(`${record.affiliateId}:${record.year}`, record.id)
  }
  return record
}

/**
 * SIMULATED 1099-NEC aggregate: sums `paid` payout items for the affiliate
 * whose payment timestamp (`item.paidAt`, falling back to `run.completedAt`
 * for items that predate the field) falls inside `year` — compared by UTC
 * year so attribution does not depend on the server's timezone. Real IRS
 * filing/e-file is out of scope — this is reporting scaffolding.
 * Throws `TaxFormValidationError` on a bad year and
 * `TaxFormNotFoundError` for an unknown affiliate.
 */
export function generate1099Data(affiliateId: string, year: number): Tax1099Data {
  const account = affiliateById(affiliateId)
  const taxYear = assertTaxYear(year)

  let totalPaidCents = 0
  for (const run of listRuns()) {
    const detail = getRun(run.id)
    if (!detail) continue
    for (const item of detail.items) {
      if (item.status !== "paid" || item.affiliateId !== account.id) continue
      // Attribute by when THIS item was marked paid — `run.completedAt` is
      // overwritten on every `processRun` call, so a failed run retried in
      // January would otherwise drag December payments into the new year.
      const paidAt = item.paidAt ?? run.completedAt
      if (!paidAt) continue
      if (new Date(paidAt).getUTCFullYear() !== taxYear) continue
      totalPaidCents += item.amountCents
    }
  }

  return {
    affiliateId: account.id,
    year: taxYear,
    totalPaidCents,
    formType: "1099-NEC",
  }
}

/**
 * Builds the partner's W-9 draft. `name` defaults to the affiliate
 * account's email (the account model has no personal-name field); stored
 * `W9Details` from a prior submission override the defaults. `tinProvided`
 * is true once the partner has submitted a W-9 or an admin marked one on
 * file — the TIN value itself is never part of this object.
 */
export function generateW9Draft(affiliateId: string): W9Draft {
  const account = affiliateById(affiliateId)
  const details = w9DetailsByAffiliate.get(account.id)
  const record = listTaxForms({ affiliateId: account.id, formType: "w9" })[0]
  return {
    affiliateId: account.id,
    name: details?.name ?? account.email,
    ...(details?.businessName ? { businessName: details.businessName } : {}),
    taxClassification: details?.taxClassification ?? "individual",
    tinProvided: details?.tinProvided ?? (record !== undefined && record.status !== "draft"),
  }
}

export interface SubmitW9Input {
  name?: string
  businessName?: string
  taxClassification?: W9TaxClassification
  tinProvided?: boolean
}

/**
 * TIN-shaped value guard for free-text W-9 fields (`name`, `businessName`).
 * The W-9 API deliberately has no TIN field, but without this guard a
 * partner could paste an SSN/EIN into a name field and have it persisted
 * and echoed back via GET. The patterns deliberately do NOT use `\b`
 * word boundaries: `\b` is bypassed by glued-on word characters
 * ("SSN123-45-6789", "123-45-6789x", "abc123456789def"), so the digit
 * groups are matched wherever they appear. Separators between digit
 * groups may be a dash, dot, or whitespace, covering dashed, dotted,
 * and spaced variants. SSN/ITIN shape is ###-##-#### (9 digits); EIN
 * shape is ##-####### (also 9 digits). Because any 9-digit run matches
 * the EIN shape, this also rejects bare 9+-digit runs — including
 * phone-number-like values. That over-rejection is intentional and
 * defensible for a W-9 name/businessName field: legitimate names rarely
 * contain 9 consecutive digits, and the cost of a false positive is a
 * validation error the partner can fix, while the cost of a miss is a
 * TIN persisted in cleartext. Exported so the route schema can reject
 * the same values at the edge with a 400 before they reach the library.
 */
const TIN_LIKE_PATTERNS = [
  /\d{3}[-.\s]?\d{2}[-.\s]?\d{4}/, // SSN / ITIN (dashed, dotted, spaced, or bare)
  /\d{2}[-.\s]?\d{7}/, // EIN — also catches any bare 9-digit run
] as const

export function containsTinShapedValue(value: string): boolean {
  return TIN_LIKE_PATTERNS.some((pattern) => pattern.test(value))
}

function assertNoTinShapedValue(field: "name" | "businessName", value: string): void {
  if (value && containsTinShapedValue(value)) {
    throw new TaxFormValidationError(
      `${field} must not contain a tax identification number (SSN/EIN).`,
    )
  }
}

/**
 * Validates partner-supplied W-9 details and returns the normalized subset
 * that was actually provided. There is intentionally no TIN parameter —
 * callers must not (and cannot, via the strict API schema) pass one
 * through. Free-text fields are additionally screened for TIN-shaped values
 * (`containsTinShapedValue`) so an SSN/EIN cannot be smuggled through a
 * name field.
 */
function assertW9Input(input: SubmitW9Input): {
  name?: string
  businessName?: string
  taxClassification?: W9TaxClassification
  tinProvided?: boolean
} {
  const name = (input.name ?? "").trim()
  if (name.length > W9_NAME_MAX_LENGTH) {
    throw new TaxFormValidationError(`name must be at most ${W9_NAME_MAX_LENGTH} characters.`)
  }
  assertNoTinShapedValue("name", name)
  const businessName = (input.businessName ?? "").trim()
  if (businessName.length > W9_NAME_MAX_LENGTH) {
    throw new TaxFormValidationError(
      `businessName must be at most ${W9_NAME_MAX_LENGTH} characters.`,
    )
  }
  assertNoTinShapedValue("businessName", businessName)
  if (
    input.taxClassification !== undefined &&
    !W9_TAX_CLASSIFICATIONS.includes(input.taxClassification)
  ) {
    throw new TaxFormValidationError(
      `taxClassification must be one of: ${W9_TAX_CLASSIFICATIONS.join(", ")}.`,
    )
  }
  if (input.tinProvided !== undefined && typeof input.tinProvided !== "boolean") {
    throw new TaxFormValidationError("tinProvided must be a boolean.")
  }
  return {
    ...(name ? { name } : {}),
    ...(businessName ? { businessName } : {}),
    ...(input.taxClassification !== undefined
      ? { taxClassification: input.taxClassification }
      : {}),
    ...(input.tinProvided !== undefined ? { tinProvided: input.tinProvided } : {}),
  }
}

/**
 * Upserts the partner's W-9: stores non-sensitive details and creates (or
 * refreshes) the single `w9` record for the affiliate with status
 * `submitted`. A record already `on_file` stays `on_file` (the partner may
 * still update details). Throws `TaxFormNotFoundError` for unknown
 * affiliates.
 */
export function submitW9(affiliateId: string, input: SubmitW9Input = {}): TaxFormRecord {
  const account = affiliateById(affiliateId)
  const provided = assertW9Input(input)
  // Partial update: omitted fields keep their previously stored values.
  const priorDetails = w9DetailsByAffiliate.get(account.id)
  const details: W9Details = {
    name: provided.name ?? priorDetails?.name ?? account.email,
    ...(provided.businessName !== undefined
      ? { businessName: provided.businessName }
      : priorDetails?.businessName
        ? { businessName: priorDetails.businessName }
        : {}),
    taxClassification:
      provided.taxClassification ?? priorDetails?.taxClassification ?? "individual",
    tinProvided: provided.tinProvided ?? priorDetails?.tinProvided ?? false,
  }
  w9DetailsByAffiliate.set(account.id, details)

  const existingRecord = listTaxForms({ affiliateId: account.id, formType: "w9" })[0]
  const status: TaxFormStatus = existingRecord?.status === "on_file" ? "on_file" : "submitted"
  return upsertRecord({
    affiliateId: account.id,
    formType: "w9",
    status,
    indexKey: account.id,
    index: w9ByAffiliate,
  })
}

export interface Generate1099Result {
  record: TaxFormRecord
  data: Tax1099Data
}

/**
 * Admin action: generates (or regenerates) the simulated 1099-NEC for an
 * affiliate+year. Upsert semantics — one record per affiliate+year; a
 * record already `on_file` stays `on_file`, otherwise the record becomes
 * `draft`. Returns the record plus the aggregate data. No filing occurs.
 */
export function generate1099ForAffiliate(affiliateId: string, year: number): Generate1099Result {
  const data = generate1099Data(affiliateId, year)
  const existing = listTaxForms({
    affiliateId: data.affiliateId,
    formType: "1099-nec",
    year: data.year,
  })[0]
  const status: TaxFormStatus = existing?.status === "on_file" ? "on_file" : "draft"
  const record = upsertRecord({
    affiliateId: data.affiliateId,
    formType: "1099-nec",
    year: data.year,
    status,
    indexKey: `${data.affiliateId}:${data.year}`,
    index: necByAffiliateYear,
  })
  return { record, data }
}

/**
 * Status machine: `draft|submitted → on_file`. `on_file` is terminal —
 * illegal transitions throw `TaxFormTransitionError` (the API answers
 * 409). Returns null for unknown record ids.
 */
export function markTaxFormOnFile(id: string): TaxFormRecord | null {
  const record = records.get(id)
  if (!record) return null
  if (record.status === "on_file") {
    throw new TaxFormTransitionError("file", record.status)
  }
  record.status = "on_file"
  record.updatedAt = nowIso()
  return record
}

/** Admin/partner listing, newest first. All filters are optional. */
export function listTaxForms(
  filter: {
    affiliateId?: string
    formType?: TaxFormType
    year?: number
    status?: TaxFormStatus
  } = {},
): TaxFormRecord[] {
  const affiliateId = filter.affiliateId?.trim()
  return [...records.values()]
    .reverse()
    .filter(
      (record) =>
        (affiliateId === undefined || affiliateId === "" || record.affiliateId === affiliateId) &&
        (filter.formType === undefined || record.formType === filter.formType) &&
        (filter.year === undefined || record.year === filter.year) &&
        (filter.status === undefined || record.status === filter.status),
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

/** One record by id, or null when unknown. */
export function getTaxForm(id: string): TaxFormRecord | null {
  return records.get(id) ?? null
}

/**
 * Spreadsheet formula-injection guard: a cell whose text begins with
 * `=`, `+`, `-`, or `@` is evaluated as a formula by Excel/Sheets/LibreOffice,
 * so such values are prefixed with a single quote before quoting/escaping.
 */
const CSV_FORMULA_PREFIX = /^[=+\-@]/

function csvEscape(value: string): string {
  const guarded = CSV_FORMULA_PREFIX.test(value) ? `'${value}` : value
  if (/[",\n\r]/.test(guarded)) {
    return `"${guarded.replace(/"/g, '""')}"`
  }
  return guarded
}

/**
 * Admin CSV export: one row per affiliate account with its simulated
 * 1099-NEC totals for `year` — affiliates with no paid payouts appear with
 * zero totals so the export is a complete payment roster. Columns:
 * affiliate_id, email, year, total_paid_cents, currency, form_type.
 */
export function exportTaxSummaryCsv(year: number): string {
  const taxYear = assertTaxYear(year)
  const header = "affiliate_id,email,year,total_paid_cents,currency,form_type"
  const rows = listAffiliates().map((account) => {
    const data = generate1099Data(account.id, taxYear)
    return [
      csvEscape(account.id),
      csvEscape(account.email),
      String(data.year),
      String(data.totalPaidCents),
      "USD",
      data.formType,
    ].join(",")
  })
  return [header, ...rows].join("\r\n") + "\r\n"
}

/** Test hook: clears all tax form records and W-9 details. */
export function resetTaxFormsForTests(): void {
  records.clear()
  w9DetailsByAffiliate.clear()
  w9ByAffiliate.clear()
  necByAffiliateYear.clear()
}
