/**
 * Commission ledger for the affiliate program.
 *
 * DEVELOPMENT SEAM: state lives in a process-local array, the same
 * interim-store pattern as `affiliate.ts` / `announcements.ts`. On
 * serverless or multi-instance deploys each instance keeps its own copy —
 * commissions are lost on restart and are not shared between instances.
 * The upgrade path is a `Commission` table; the exported function
 * signatures are already shaped for that swap.
 *
 * REPORTING ONLY: `status: "paid"` is a ledger bookkeeping state — it does
 * NOT move money. There is no payout pipeline here; payout automation is a
 * separate task. `currency` is fixed to "USD" and `amountCents` is stored as
 * an integer number of cents.
 *
 * Conversion → commission wiring is a FUTURE HOOK: today
 * `recordConversion` in `affiliate.ts` only computes a projected
 * `commissionCents` figure; nothing calls `recordCommission`
 * automatically. Admins (or a later job) record commissions manually via
 * `POST /api/admin/commissions`, optionally linking a `conversionId` for
 * traceability.
 *
 * Server-only in practice: imported by route handlers and tests; client
 * components must not import it.
 */

export type CommissionStatus = "pending" | "approved" | "paid" | "void"

export const COMMISSION_STATUSES: readonly CommissionStatus[] = [
  "pending",
  "approved",
  "paid",
  "void",
]

export interface CommissionRecord {
  id: string
  /** `AffiliateAccount.id` this commission belongs to. */
  affiliateId: string
  /** Optional link back to an `AffiliateConversion.id` for traceability. */
  conversionId?: string
  /** Integer cents; must be non-negative. */
  amountCents: number
  /** Fixed reporting currency; no FX is performed. */
  currency: "USD"
  status: CommissionStatus
  /** Human-readable note (e.g. "manual adjustment", "conversion afv_…"). */
  reason: string
  /** ISO timestamp — record creation time. */
  createdAt: string
  /** ISO timestamp — last status transition. */
  updatedAt: string
}

export type CommissionAdminAction = "approve" | "void" | "mark-paid"

/**
 * Server-side status machine. `void` is allowed from both `pending` and
 * `approved` (a clawback may be discovered before or after approval, as long
 * as money has not been marked paid); `paid` and `void` are terminal — a
 * paid commission cannot be voided here because payout automation (a later
 * task) owns reversal handling.
 *
 *   pending  → approve → approved  |  void → void
 *   approved → mark-paid → paid    |  void → void
 *   paid, void — terminal
 *
 * Illegal combinations throw `CommissionTransitionError` (the API answers
 * 409). This mirrors `actionsFor` in `src/components/admin/commissions-screen.tsx`,
 * which only renders buttons for legal transitions.
 */
const COMMISSION_TRANSITIONS: Record<
  CommissionAdminAction,
  { to: CommissionStatus; from: readonly CommissionStatus[] }
> = {
  approve: { to: "approved", from: ["pending"] },
  void: { to: "void", from: ["pending", "approved"] },
  "mark-paid": { to: "paid", from: ["approved"] },
}

/** Hard cap so the in-memory ledger cannot grow without bound. */
export const COMMISSIONS_STORE_MAX = 10_000

const REASON_MAX_LENGTH = 500

const commissions: CommissionRecord[] = [] // insertion order = creation order

function commissionRecordId(): string {
  return `com_${crypto.randomUUID()}`
}

function nowIso(): string {
  return new Date().toISOString()
}

export interface RecordCommissionInput {
  affiliateId: string
  conversionId?: string
  amountCents: number
  reason?: string
}

/**
 * Appends a `pending` commission to the ledger. `affiliateId` must be a
 * non-empty affiliate account id (existence in the affiliate store is the
 * caller's responsibility — the admin route validates it). `amountCents`
 * must be a non-negative integer. Throws a plain `Error` with a user-facing
 * message on validation failure or when the store bound is reached.
 */
export function recordCommission(input: RecordCommissionInput): CommissionRecord {
  const affiliateId = input.affiliateId.trim()
  if (!affiliateId) throw new Error("An affiliate id is required.")
  if (!Number.isInteger(input.amountCents) || input.amountCents < 0) {
    throw new Error("amountCents must be a non-negative integer.")
  }
  const reason = (input.reason ?? "").trim()
  if (reason.length > REASON_MAX_LENGTH) {
    throw new Error(`reason must be at most ${REASON_MAX_LENGTH} characters.`)
  }
  const conversionId = input.conversionId?.trim() || undefined

  if (commissions.length >= COMMISSIONS_STORE_MAX) {
    throw new Error("The commission ledger is currently at capacity. Try again later.")
  }

  const at = nowIso()
  const record: CommissionRecord = {
    id: commissionRecordId(),
    affiliateId,
    ...(conversionId ? { conversionId } : {}),
    amountCents: input.amountCents,
    currency: "USD",
    status: "pending",
    reason: reason || "Manual commission entry.",
    createdAt: at,
    updatedAt: at,
  }
  commissions.push(record)
  return record
}

/**
 * Admin listing, newest first. `affiliateId` and `status` filters narrow the
 * result when provided.
 */
export function listCommissions(
  filter: {
    affiliateId?: string
    status?: CommissionStatus
  } = {},
): CommissionRecord[] {
  const affiliateId = filter.affiliateId?.trim()
  return [...commissions]
    .reverse()
    .filter(
      (record) =>
        (affiliateId === undefined || affiliateId === "" || record.affiliateId === affiliateId) &&
        (filter.status === undefined || record.status === filter.status),
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

/**
 * Per-affiliate commission totals in integer cents, broken down by status so
 * callers can distinguish money awaiting approval, approved-but-unpaid, and
 * already-marked-paid. `void` commissions are excluded from every payable
 * bucket but counted separately for auditability.
 */
export interface CommissionTotals {
  count: number
  pendingCents: number
  approvedCents: number
  paidCents: number
  voidCents: number
}

export function commissionTotalsForAffiliate(affiliateId: string): CommissionTotals {
  const totals: CommissionTotals = {
    count: 0,
    pendingCents: 0,
    approvedCents: 0,
    paidCents: 0,
    voidCents: 0,
  }
  const id = affiliateId.trim()
  if (!id) return totals
  for (const record of commissions) {
    if (record.affiliateId !== id) continue
    totals.count += 1
    switch (record.status) {
      case "pending":
        totals.pendingCents += record.amountCents
        break
      case "approved":
        totals.approvedCents += record.amountCents
        break
      case "paid":
        totals.paidCents += record.amountCents
        break
      case "void":
        totals.voidCents += record.amountCents
        break
    }
  }
  return totals
}

/** Thrown when an admin action is applied to a status that does not allow it. */
export class CommissionTransitionError extends Error {
  constructor(
    public readonly action: CommissionAdminAction,
    public readonly from: CommissionStatus,
  ) {
    super(`Cannot ${action} a commission in status "${from}".`)
    this.name = "CommissionTransitionError"
  }
}

function transition(id: string, action: CommissionAdminAction): CommissionRecord | null {
  const record = commissions.find((entry) => entry.id === id)
  if (!record) return null
  const rule = COMMISSION_TRANSITIONS[action]
  if (!rule.from.includes(record.status)) {
    throw new CommissionTransitionError(action, record.status)
  }
  record.status = rule.to
  record.updatedAt = nowIso()
  return record
}

/** Approves a pending commission so it can be marked paid. */
export function approveCommission(id: string): CommissionRecord | null {
  return transition(id, "approve")
}

/** Voids a pending or approved commission; void is terminal. */
export function voidCommission(id: string): CommissionRecord | null {
  return transition(id, "void")
}

/**
 * Marks an approved commission as paid. LEDGER ONLY — no money moves; real
 * payouts are handled by a separate task. Paid is terminal.
 */
export function markCommissionPaid(id: string): CommissionRecord | null {
  return transition(id, "mark-paid")
}

/**
 * Test hook: clears all commission records. Named `resetCommissionsForTests`
 * per the ledger contract; `clearCommissionsForTests` is kept as an alias
 * matching the `clearAffiliateStoreForTests` naming convention.
 */
export function resetCommissionsForTests(): void {
  commissions.length = 0
}

export const clearCommissionsForTests = resetCommissionsForTests
