/**
 * Compliance reporting for the affiliate/partner program.
 *
 * Two halves live here:
 *
 *  1. A bounded in-memory store of compliance CASES — investigations opened
 *     by admins against affiliates, partners, or users (fraud reviews,
 *     policy violations, payout holds, KYC, misc). Cases carry an append-only
 *     note log; status moves through a strict state machine
 *     (`open → investigating → resolved|dismissed`, terminal at the end).
 *
 *  2. Pure REPORT generators that aggregate the existing dev-seam stores —
 *     affiliates (`affiliate.ts`), the referral-fraud flag queue
 *     (`referral-fraud.ts`), the commission ledger (`commissions.ts`),
 *     simulated payouts (`payouts.ts`), and tax forms (`tax-forms.ts`) —
 *     into a program compliance report and an audit-trail CSV.
 *
 * DEVELOPMENT SEAM: case state lives in a process-local `Map`, the same
 * interim-store pattern as `affiliate.ts` / `referral-fraud.ts`. On
 * serverless or multi-instance deploys each instance keeps its own copy —
 * cases and notes are lost on restart and are not shared between instances.
 * The upgrade path is `ComplianceCase` / `ComplianceCaseNote` tables; the
 * exported function signatures are already shaped for that swap.
 *
 * Server-only in practice: imported by route handlers and tests; client
 * components must not import it.
 */

import { AFFILIATE_STATUSES, listAffiliates, type AffiliateStatus } from "./affiliate"
import { listCommissions } from "./commissions"
import { getRun, listRuns, type PayoutItemStatus, type PayoutRunStatus } from "./payouts"
import { listFlags, type FlaggedReferral } from "./referral-fraud"
import { listTaxForms, TAX_FORM_STATUSES, type TaxFormStatus } from "./tax-forms"

/* ------------------------------------------------------------------ */
/* Case model                                                          */
/* ------------------------------------------------------------------ */

export const COMPLIANCE_CASE_TYPES = [
  "fraud_review",
  "policy_violation",
  "payout_hold",
  "kyc",
  "other",
] as const
export type ComplianceCaseType = (typeof COMPLIANCE_CASE_TYPES)[number]

export const COMPLIANCE_CASE_STATUSES = ["open", "investigating", "resolved", "dismissed"] as const
export type ComplianceCaseStatus = (typeof COMPLIANCE_CASE_STATUSES)[number]

export const COMPLIANCE_CASE_PRIORITIES = ["low", "medium", "high"] as const
export type ComplianceCasePriority = (typeof COMPLIANCE_CASE_PRIORITIES)[number]

export const COMPLIANCE_SUBJECT_TYPES = ["affiliate", "partner", "user"] as const
export type ComplianceSubjectType = (typeof COMPLIANCE_SUBJECT_TYPES)[number]

/**
 * One append-only entry in a case's note log. `kind` distinguishes plain
 * admin notes from the system entries `transitionCase` writes; `actorId` is
 * the verified admin email (or `"system"` for machine-written entries).
 * Entries are never editable or deletable through this module.
 */
export interface ComplianceCaseNote {
  id: string
  kind: "note" | "transition"
  actorId: string
  body: string
  /** ISO timestamp. */
  at: string
}

export interface ComplianceCase {
  id: string
  type: ComplianceCaseType
  subjectType: ComplianceSubjectType
  subjectId: string
  status: ComplianceCaseStatus
  priority: ComplianceCasePriority
  /** Append-only; returned copies must not be mutated by callers. */
  notes: ComplianceCaseNote[]
  /** ISO timestamp — case creation time. */
  createdAt: string
  /** ISO timestamp — last mutation (note or transition). */
  updatedAt: string
  /** ISO timestamp — set when the case reaches `resolved`. */
  resolvedAt?: string
}

/** Hard caps so the in-memory store cannot grow without bound. */
export const COMPLIANCE_CASES_STORE_MAX = 1_000
export const COMPLIANCE_NOTES_PER_CASE_MAX = 200
export const COMPLIANCE_NOTE_BODY_MAX = 4_000
export const COMPLIANCE_CASES_LIST_MAX = 500

const SYSTEM_ACTOR_ID = "system"

const cases = new Map<string, ComplianceCase>() // id → case

function caseId(): string {
  return `ccase_${crypto.randomUUID()}`
}

function noteId(): string {
  return `cnote_${crypto.randomUUID()}`
}

function nowIso(): string {
  return new Date().toISOString()
}

/** Error codes the API routes map to HTTP statuses. */
export type ComplianceErrorCode = "not_found" | "invalid_input" | "invalid_transition" | "capacity"

export class ComplianceError extends Error {
  readonly code: ComplianceErrorCode
  constructor(code: ComplianceErrorCode, message: string) {
    super(message)
    this.name = "ComplianceError"
    this.code = code
  }
}

function isCaseType(value: string): value is ComplianceCaseType {
  return (COMPLIANCE_CASE_TYPES as readonly string[]).includes(value)
}

function isSubjectType(value: string): value is ComplianceSubjectType {
  return (COMPLIANCE_SUBJECT_TYPES as readonly string[]).includes(value)
}

function isPriority(value: string): value is ComplianceCasePriority {
  return (COMPLIANCE_CASE_PRIORITIES as readonly string[]).includes(value)
}

function assertNoteBody(body: string): string {
  const trimmed = body.trim()
  if (!trimmed) throw new ComplianceError("invalid_input", "A note body is required.")
  if (trimmed.length > COMPLIANCE_NOTE_BODY_MAX) {
    throw new ComplianceError(
      "invalid_input",
      `A note must be at most ${COMPLIANCE_NOTE_BODY_MAX} characters.`,
    )
  }
  return trimmed
}

function appendNote(
  record: ComplianceCase,
  kind: ComplianceCaseNote["kind"],
  actorId: string,
  body: string,
): void {
  if (record.notes.length >= COMPLIANCE_NOTES_PER_CASE_MAX) {
    throw new ComplianceError("capacity", "This case has reached its note limit.")
  }
  record.notes.push({
    id: noteId(),
    kind,
    actorId: actorId.trim() || SYSTEM_ACTOR_ID,
    body,
    at: nowIso(),
  })
  record.updatedAt = nowIso()
}

/* ------------------------------------------------------------------ */
/* Case store                                                          */
/* ------------------------------------------------------------------ */

export interface CreateComplianceCaseInput {
  type: ComplianceCaseType
  subjectType: ComplianceSubjectType
  subjectId: string
  priority?: ComplianceCasePriority
}

/**
 * Opens a new compliance case in `open` status. `subjectId` is an opaque
 * reference (affiliate account id, partner id, or user id — the store does
 * not validate it against other modules). Throws `ComplianceError` on bad
 * input or when the case store is full.
 */
export function createCase(input: CreateComplianceCaseInput): ComplianceCase {
  if (!isCaseType(input.type)) {
    throw new ComplianceError(
      "invalid_input",
      `type must be one of: ${COMPLIANCE_CASE_TYPES.join(", ")}.`,
    )
  }
  if (!isSubjectType(input.subjectType)) {
    throw new ComplianceError(
      "invalid_input",
      `subjectType must be one of: ${COMPLIANCE_SUBJECT_TYPES.join(", ")}.`,
    )
  }
  const subjectId = input.subjectId.trim()
  if (!subjectId) {
    throw new ComplianceError("invalid_input", "A subject id is required.")
  }
  const priority = input.priority ?? "medium"
  if (!isPriority(priority)) {
    throw new ComplianceError(
      "invalid_input",
      `priority must be one of: ${COMPLIANCE_CASE_PRIORITIES.join(", ")}.`,
    )
  }
  if (cases.size >= COMPLIANCE_CASES_STORE_MAX) {
    throw new ComplianceError("capacity", "The compliance case store is at capacity.")
  }

  const at = nowIso()
  const record: ComplianceCase = {
    id: caseId(),
    type: input.type,
    subjectType: input.subjectType,
    subjectId,
    status: "open",
    priority,
    notes: [],
    createdAt: at,
    updatedAt: at,
  }
  cases.set(record.id, record)
  return copyCase(record)
}

/**
 * Appends an immutable note to a case. Notes are never editable or
 * deletable — the only way to "correct" one is to add another. Throws
 * `ComplianceError("not_found")` for unknown ids.
 */
export function addNote(caseIdValue: string, actorId: string, body: string): ComplianceCase {
  const record = cases.get(caseIdValue)
  if (!record) throw new ComplianceError("not_found", "Compliance case not found.")
  appendNote(record, "note", actorId, assertNoteBody(body))
  return copyCase(record)
}

/**
 * Server-side status machine. Legal edges:
 *
 *   open         → investigating
 *   investigating → resolved | dismissed
 *   resolved, dismissed — terminal
 *
 * Every transition appends a `kind: "transition"` note recording the actor
 * and the from→to move (so the append-only log doubles as the audit trail);
 * an optional free-text `note` is validated with the same rules as
 * `addNote` (trimmed, non-empty, ≤ `COMPLIANCE_NOTE_BODY_MAX`) and embedded
 * in the transition entry. `resolvedAt` is stamped only on `resolved`.
 * Illegal edges throw `ComplianceError("invalid_transition")` — the API
 * answers 409.
 *
 * Ordering matters: the transition note is appended BEFORE `status` is
 * committed. `appendNote` throws `ComplianceError("capacity")` when the
 * case is at its note limit, and a failed append must leave the case
 * completely untouched — otherwise the status would change without an
 * audit entry and a retry would hit `invalid_transition` instead of
 * `capacity`.
 */
const CASE_TRANSITIONS: Record<ComplianceCaseStatus, readonly ComplianceCaseStatus[]> = {
  open: ["investigating"],
  investigating: ["resolved", "dismissed"],
  resolved: [],
  dismissed: [],
}

export interface TransitionCaseOptions {
  /** Verified admin email stamped on the transition note. */
  actorId?: string
  /** Optional free-text note appended alongside the transition entry. */
  note?: string
}

export function transitionCase(
  caseIdValue: string,
  to: ComplianceCaseStatus,
  options: TransitionCaseOptions = {},
): ComplianceCase {
  const record = cases.get(caseIdValue)
  if (!record) throw new ComplianceError("not_found", "Compliance case not found.")
  if (!COMPLIANCE_CASE_STATUSES.includes(to)) {
    throw new ComplianceError("invalid_input", `Unknown case status "${to}".`)
  }
  if (!CASE_TRANSITIONS[record.status].includes(to)) {
    throw new ComplianceError(
      "invalid_transition",
      `Cannot move a case from "${record.status}" to "${to}".`,
    )
  }

  // Validate the embedded note and append the transition entry first — see
  // the ordering note in the docstring above.
  const from = record.status
  const note = options.note === undefined ? undefined : assertNoteBody(options.note)
  appendNote(
    record,
    "transition",
    options.actorId ?? SYSTEM_ACTOR_ID,
    `Status changed from "${from}" to "${to}".${note ? ` ${note}` : ""}`,
  )
  record.status = to
  if (to === "resolved") record.resolvedAt = nowIso()
  return copyCase(record)
}

function copyNote(note: ComplianceCaseNote): ComplianceCaseNote {
  return { ...note }
}

/** Deep-enough copy so callers cannot mutate store state via returned values. */
function copyCase(record: ComplianceCase): ComplianceCase {
  return { ...record, notes: record.notes.map(copyNote) }
}

export interface ComplianceCaseFilter {
  status?: ComplianceCaseStatus
  type?: ComplianceCaseType
  priority?: ComplianceCasePriority
  subjectType?: ComplianceSubjectType
  subjectId?: string
  limit?: number
  offset?: number
}

/**
 * Admin listing, newest first (`createdAt` desc, id desc for ties). All
 * filters are optional. `limit` is clamped to
 * `COMPLIANCE_CASES_LIST_MAX`; returns live-shape copies — callers must not
 * mutate them expecting store effects.
 */
export function listCases(filter: ComplianceCaseFilter = {}): {
  items: ComplianceCase[]
  total: number
} {
  const subjectId = filter.subjectId?.trim()
  // Reversing first makes same-ms creations resolve to most-recently-created
  // first (the sort below is stable), matching listAffiliates' convention.
  const all = [...cases.values()]
    .reverse()
    .filter(
      (record) =>
        (filter.status === undefined || record.status === filter.status) &&
        (filter.type === undefined || record.type === filter.type) &&
        (filter.priority === undefined || record.priority === filter.priority) &&
        (filter.subjectType === undefined || record.subjectType === filter.subjectType) &&
        (subjectId === undefined || subjectId === "" || record.subjectId === subjectId),
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const offset = Math.max(filter.offset ?? 0, 0)
  const limit = Math.min(
    Math.max(filter.limit ?? COMPLIANCE_CASES_LIST_MAX, 1),
    COMPLIANCE_CASES_LIST_MAX,
  )
  return { items: all.slice(offset, offset + limit).map(copyCase), total: all.length }
}

/** One case by id (copy), or null when unknown. */
export function getCase(caseIdValue: string): ComplianceCase | null {
  const record = cases.get(caseIdValue)
  return record ? copyCase(record) : null
}

/** JSON-safe case view for API responses. */
export function complianceCaseJson(record: ComplianceCase) {
  return {
    id: record.id,
    type: record.type,
    subjectType: record.subjectType,
    subjectId: record.subjectId,
    status: record.status,
    priority: record.priority,
    notes: record.notes.map((note) => ({ ...note })),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    resolvedAt: record.resolvedAt ?? null,
  }
}

export interface ComplianceStats {
  cases: Record<ComplianceCaseStatus, number> & { total: number }
  /** Cases still needing attention (`open` + `investigating`). */
  openByType: Partial<Record<ComplianceCaseType, number>>
  openByPriority: Partial<Record<ComplianceCasePriority, number>>
  notesTotal: number
}

/** Aggregate counts for dashboards: per-status totals plus open-case breakdowns. */
export function complianceStats(): ComplianceStats {
  const byStatus = countBy(COMPLIANCE_CASE_STATUSES)
  const all = [...cases.values()]
  let notesTotal = 0
  for (const record of all) {
    byStatus[record.status] += 1
    notesTotal += record.notes.length
  }
  const open = all.filter((record) => record.status === "open" || record.status === "investigating")
  return {
    cases: { ...byStatus, total: all.length },
    openByType: tally(open, (record) => record.type),
    openByPriority: tally(open, (record) => record.priority),
    notesTotal,
  }
}

/* ------------------------------------------------------------------ */
/* Reporting                                                           */
/* ------------------------------------------------------------------ */

/**
 * Optional reporting window. `start` is inclusive, `end` exclusive; both
 * are ISO date/datetime strings. Omitted bounds mean "unbounded".
 */
export interface CompliancePeriod {
  start?: string
  end?: string
}

function assertPeriod(period: CompliancePeriod | undefined): void {
  if (!period) return
  for (const bound of [period.start, period.end]) {
    if (bound !== undefined && Number.isNaN(Date.parse(bound))) {
      throw new ComplianceError("invalid_input", "Period bounds must be valid ISO dates.")
    }
  }
  if (
    period.start !== undefined &&
    period.end !== undefined &&
    Date.parse(period.start) >= Date.parse(period.end)
  ) {
    throw new ComplianceError("invalid_input", "Period start must be before period end.")
  }
}

/** Inclusive-start / exclusive-end ISO comparison against a period. */
function inPeriod(iso: string, period: CompliancePeriod | undefined): boolean {
  if (!period) return true
  const at = Date.parse(iso)
  if (Number.isNaN(at)) return false
  if (period.start !== undefined && at < Date.parse(period.start)) return false
  if (period.end !== undefined && at >= Date.parse(period.end)) return false
  return true
}

function countBy<T extends string>(values: readonly T[]): Record<T, number> {
  const counts = {} as Record<T, number>
  for (const value of values) counts[value] = 0
  return counts
}

function tally<TItem, TKey extends string>(
  items: readonly TItem[],
  pick: (item: TItem) => TKey,
): Partial<Record<TKey, number>> {
  const out: Partial<Record<TKey, number>> = {}
  for (const item of items) {
    const key = pick(item)
    out[key] = (out[key] ?? 0) + 1
  }
  return out
}

export interface ProgramComplianceReport {
  period: { start: string | null; end: string | null }
  affiliates: {
    total: number
    /** All-time counts per affiliate status. */
    byStatus: Record<AffiliateStatus, number>
    /** Accounts created inside the period. */
    createdInPeriod: number
  }
  cases: {
    total: number
    createdInPeriod: number
    byStatus: Record<ComplianceCaseStatus, number>
    byType: Partial<Record<ComplianceCaseType, number>>
    openByType: Partial<Record<ComplianceCaseType, number>>
    openByPriority: Partial<Record<ComplianceCasePriority, number>>
  }
  fraudFlags: {
    total: number
    byStatus: Record<"pending" | "cleared" | "confirmed_fraud", number>
    scannedInPeriod: number
  }
  commissions: {
    total: number
    createdInPeriod: number
    amountCentsByStatus: Partial<Record<string, number>>
  }
  payouts: {
    /** All-time run count; `runsInPeriod` is the period-scoped subset. */
    runsTotal: number
    /** All-time run counts per status (runs are not period-filtered here). */
    runsByStatus: Partial<Record<PayoutRunStatus, number>>
    /**
     * All-time item count across ALL runs' items. Payout items carry no
     * timestamp of their own, so — intentionally asymmetric with the
     * period-scoped `runsInPeriod` — they cannot be period-filtered and are
     * always reported for all time.
     */
    itemsTotal: number
    /** All-time item amount (cents) per status — same all-time scope. */
    itemsAmountCentsByStatus: Partial<Record<PayoutItemStatus, number>>
    /** Runs created inside the period (start inclusive, end exclusive). */
    runsInPeriod: number
  }
  taxForms: {
    total: number
    byStatus: Record<TaxFormStatus, number>
    createdInPeriod: number
  }
}

/**
 * Aggregates the affiliate program's compliance posture for `period`
 * (default: all time). Reads the sibling dev-seam stores read-only —
 * affiliates, referral-fraud flags, commissions, simulated payout runs and
 * items, and tax form records. Period filtering applies to each record's
 * creation/scan timestamp (`start` inclusive, `end` exclusive).
 */
export function generateProgramComplianceReport(
  options: {
    period?: CompliancePeriod
  } = {},
): ProgramComplianceReport {
  const period = options.period
  assertPeriod(period)

  // Affiliates
  const affiliateRecords = listAffiliates()
  const affiliateByStatus = countBy(AFFILIATE_STATUSES)
  for (const account of affiliateRecords) affiliateByStatus[account.status] += 1

  // Cases (all cases — the store is already bounded)
  const allCases = [...cases.values()]
  const caseByStatus = countBy(COMPLIANCE_CASE_STATUSES)
  for (const record of allCases) caseByStatus[record.status] += 1
  const openCases = allCases.filter(
    (record) => record.status === "open" || record.status === "investigating",
  )
  const casesInPeriod = allCases.filter((record) => inPeriod(record.createdAt, period))

  // Referral-fraud flags — listFlags caps each page at 500 items while the
  // store holds up to REFERRAL_FLAGS_STORE_MAX (2,000), so page through the
  // whole queue to avoid silently undercounting `fraudFlags.total`.
  const flags: FlaggedReferral[] = []
  const FLAG_PAGE_SIZE = 500
  for (let offset = 0; ; offset += FLAG_PAGE_SIZE) {
    const page = listFlags({ limit: FLAG_PAGE_SIZE, offset })
    flags.push(...page.items)
    if (offset + page.items.length >= page.total) break
  }
  const fraudByStatus = { pending: 0, cleared: 0, confirmed_fraud: 0 }
  for (const flag of flags) fraudByStatus[flag.status] += 1

  // Commission ledger
  const commissions = listCommissions()
  const commissionAmountByStatus: Partial<Record<string, number>> = {}
  for (const record of commissions) {
    if (!inPeriod(record.createdAt, period)) continue
    commissionAmountByStatus[record.status] =
      (commissionAmountByStatus[record.status] ?? 0) + record.amountCents
  }

  // Simulated payouts: runs plus their items via getRun (there is no global
  // item listing in payouts.ts — items are namespaced per run).
  const runs = listRuns()
  const runByStatus: Partial<Record<PayoutRunStatus, number>> = {}
  const itemAmountByStatus: Partial<Record<PayoutItemStatus, number>> = {}
  let itemsTotal = 0
  let runsInPeriod = 0
  for (const run of runs) {
    runByStatus[run.status] = (runByStatus[run.status] ?? 0) + 1
    if (inPeriod(run.createdAt, period)) runsInPeriod += 1
    const detail = getRun(run.id)
    if (!detail) continue
    for (const item of detail.items) {
      itemsTotal += 1
      itemAmountByStatus[item.status] = (itemAmountByStatus[item.status] ?? 0) + item.amountCents
    }
  }

  // Tax form records
  const taxForms = listTaxForms()
  const taxByStatus = countBy(TAX_FORM_STATUSES)
  for (const record of taxForms) taxByStatus[record.status] += 1

  return {
    period: {
      start: period?.start ?? null,
      end: period?.end ?? null,
    },
    affiliates: {
      total: affiliateRecords.length,
      byStatus: affiliateByStatus,
      createdInPeriod: affiliateRecords.filter((account) => inPeriod(account.createdAt, period))
        .length,
    },
    cases: {
      total: allCases.length,
      createdInPeriod: casesInPeriod.length,
      byStatus: caseByStatus,
      byType: tally(allCases, (record) => record.type),
      openByType: tally(openCases, (record) => record.type),
      openByPriority: tally(openCases, (record) => record.priority),
    },
    fraudFlags: {
      total: flags.length,
      byStatus: fraudByStatus,
      scannedInPeriod: flags.filter((flag) => inPeriod(flag.scannedAt, period)).length,
    },
    commissions: {
      total: commissions.length,
      createdInPeriod: commissions.filter((record) => inPeriod(record.createdAt, period)).length,
      amountCentsByStatus: commissionAmountByStatus,
    },
    payouts: {
      runsTotal: runs.length,
      runsByStatus: runByStatus,
      itemsTotal,
      itemsAmountCentsByStatus: itemAmountByStatus,
      runsInPeriod,
    },
    taxForms: {
      total: taxForms.length,
      byStatus: taxByStatus,
      createdInPeriod: taxForms.filter((record) => inPeriod(record.createdAt, period)).length,
    },
  }
}

/* ------------------------------------------------------------------ */
/* Audit trail CSV                                                     */
/* ------------------------------------------------------------------ */

export interface AuditTrailFilter {
  /** Restrict to one case's notes. */
  caseId?: string
  /** Restrict to notes timestamped inside the period. */
  period?: CompliancePeriod
}

const CSV_FORMULA_PREFIX = /^[=+\-@]/

function csvEscape(value: string): string {
  // Neutralize spreadsheet formula injection: a leading =, +, -, or @ would
  // be evaluated as a formula by Excel/Sheets, so prefix with a quote.
  const guarded = CSV_FORMULA_PREFIX.test(value) ? `'${value}` : value
  if (/[",\n\r]/.test(guarded)) {
    return `"${guarded.replace(/"/g, '""')}"`
  }
  return guarded
}

const AUDIT_CSV_HEADER =
  "timestamp,actor_id,event,case_id,case_type,case_status,priority,subject_type,subject_id,note"

/**
 * CSV export of the append-only case log — one row per note/transition
 * entry, oldest first. `filter.caseId` scopes to a single case (unknown ids
 * throw `ComplianceError("not_found")`); `filter.period` keeps entries whose
 * `at` falls inside the window (`start` inclusive, `end` exclusive).
 */
export function generateAuditTrailCsv(filter: AuditTrailFilter = {}): string {
  assertPeriod(filter.period)

  let records: ComplianceCase[]
  if (filter.caseId !== undefined) {
    const record = cases.get(filter.caseId)
    if (!record) throw new ComplianceError("not_found", "Compliance case not found.")
    records = [record]
  } else {
    records = [...cases.values()]
  }

  const rows: string[] = [AUDIT_CSV_HEADER]
  const entries: { note: ComplianceCaseNote; record: ComplianceCase }[] = []
  for (const record of records) {
    for (const note of record.notes) {
      if (inPeriod(note.at, filter.period)) entries.push({ note, record })
    }
  }
  entries.sort((a, b) => a.note.at.localeCompare(b.note.at) || a.note.id.localeCompare(b.note.id))

  for (const { note, record } of entries) {
    rows.push(
      [
        csvEscape(note.at),
        csvEscape(note.actorId),
        csvEscape(note.kind === "transition" ? "transition" : "note"),
        csvEscape(record.id),
        csvEscape(record.type),
        csvEscape(record.status),
        csvEscape(record.priority),
        csvEscape(record.subjectType),
        csvEscape(record.subjectId),
        csvEscape(note.body),
      ].join(","),
    )
  }
  return rows.join("\r\n") + "\r\n"
}

/** Test hook: clears all compliance cases and notes. */
export function resetComplianceStoreForTests(): void {
  cases.clear()
}

/** Alias matching the `clear*StoreForTests` naming convention. */
export const clearComplianceStoreForTests = resetComplianceStoreForTests
