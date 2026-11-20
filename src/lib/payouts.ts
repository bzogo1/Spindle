/**
 * Payout automation for the affiliate program — SIMULATED ONLY.
 *
 * DEVELOPMENT SEAM: state lives in process-local `Map`s/arrays, the same
 * interim-store pattern as `affiliate.ts` / `commissions.ts`. On serverless
 * or multi-instance deploys each instance keeps its own copy — payout runs,
 * items, and payout settings are lost on restart and are not shared between
 * instances. The upgrade path is `PayoutRun` / `PayoutItem` /
 * `AffiliatePayoutSettings` tables; the exported function signatures are
 * already shaped for that swap.
 *
 * NO REAL MONEY MOVES. `processRun` is a deterministic simulation: it marks
 * each item `paid` or `failed` by applying fixed rules (see
 * `SIMULATED_FAILURE_RULES` below). There are no payment-provider calls, no
 * account numbers, and no external services. Payout method labels
 * ("paypal" | "bank_transfer" | "manual") are bookkeeping tags only.
 *
 * COMMISSION INTEGRATION: payout items reference `commissionIds` pointing at
 * `CommissionRecord.id`s in `src/lib/commissions.ts` (imported read-only —
 * this module never mutates the ledger). Claims are enforced TWICE: only
 * `approved` commissions are payable, `addItemToRun` rejects unknown,
 * foreign, non-approved, or already-claimed ids, and `processRun`
 * revalidates at payment time that every referenced commission is STILL
 * `approved` and not claimed by another `pending`/`paid` item in any run.
 * Failed items release their claims so a corrected run can claim them
 * again; when the earlier run retries and the commission has since been
 * paid out elsewhere, the retried item fails instead of double-paying. An
 * item pays only when ALL its `commissionIds` pass the payment-time
 * revalidation. NOTE: the ledger's own `paid` status is NOT updated here —
 * a future integration can reconcile `paid` payout items back into
 * `markCommissionPaid`; that wiring is deliberately out of scope for this
 * scaffolding.
 *
 * Server-only in practice: imported by route handlers and tests; client
 * components must not import it.
 */

import { listCommissions } from "./commissions"

export type PayoutRunStatus = "draft" | "processing" | "completed" | "failed"
export const PAYOUT_RUN_STATUSES: readonly PayoutRunStatus[] = [
  "draft",
  "processing",
  "completed",
  "failed",
]

export type PayoutItemStatus = "pending" | "paid" | "failed"
export const PAYOUT_ITEM_STATUSES: readonly PayoutItemStatus[] = ["pending", "paid", "failed"]

/**
 * Payout destination labels ONLY. These are display/bookkeeping tags — the
 * store deliberately has no fields for account numbers, emails-as-destinations,
 * or any credential material.
 */
export type PayoutMethod = "paypal" | "bank_transfer" | "manual"
export const PAYOUT_METHODS: readonly PayoutMethod[] = ["paypal", "bank_transfer", "manual"]

export type PayoutSchedule = "weekly" | "monthly" | "manual"
export const PAYOUT_SCHEDULES: readonly PayoutSchedule[] = ["weekly", "monthly", "manual"]

export interface PayoutRun {
  id: string
  status: PayoutRunStatus
  /** ISO date/datetime bounds of the commission period this run covers. */
  periodStart: string
  periodEnd: string
  /** ISO timestamp — run creation time. */
  createdAt: string
  /** ISO timestamp — set when processing resolves the run. */
  completedAt?: string
}

export interface PayoutItem {
  id: string
  payoutId: string
  /** `AffiliateAccount.id` the payout is owed to. */
  affiliateId: string
  /** Integer cents; must be positive. */
  amountCents: number
  status: PayoutItemStatus
  /** Set when `status === "failed"`; cleared on successful (re)processing. */
  failureReason?: string
  /**
   * ISO timestamp — set when `status` becomes `"paid"`. Kept per item (not
   * per run) so tax reporting can attribute each payment to the year it was
   * actually disbursed, even when a failed run is retried in a later year
   * and `run.completedAt` is overwritten.
   */
  paidAt?: string
  /**
   * `CommissionRecord.id`s this item pays out. May be empty for manual /
   * adjustment items that do not map to ledger entries.
   */
  commissionIds: string[]
}

export interface AffiliatePayoutSettings {
  affiliateId: string
  /** Destination label, or `null` when the affiliate has not configured one. */
  method: PayoutMethod | null
  /** Minimum accumulated cents before an automatic schedule would pay out. */
  minimumThresholdCents: number
  schedule: PayoutSchedule
}

/** Hard caps so the in-memory stores cannot grow without bound. */
export const PAYOUT_RUNS_STORE_MAX = 500
export const PAYOUT_ITEMS_PER_RUN_MAX = 200
/** A run's period may span at most this many days. */
export const PAYOUT_PERIOD_MAX_DAYS = 366
/** Default minimum payout threshold for affiliates without stored settings. */
export const DEFAULT_MINIMUM_THRESHOLD_CENTS = 5_000
/**
 * SIMULATED provider limit: in a real integration this would be a per-transfer
 * cap configured at the payment provider. Here it is a fixed constant used to
 * deterministically fail oversized items during `processRun`.
 */
export const SIMULATED_PAYOUT_ITEM_MAX_CENTS = 10_000_000 // $100,000.00
/** Cap on `commissionIds` attached to a single payout item. */
export const PAYOUT_ITEM_MAX_COMMISSIONS = 100

const runs = new Map<string, PayoutRun>() // id → run, insertion order = creation order
const itemsByRun = new Map<string, PayoutItem[]>() // payoutId → items
const settingsByAffiliate = new Map<string, AffiliatePayoutSettings>() // affiliateId → settings

function payoutRunId(): string {
  return `pay_${crypto.randomUUID()}`
}

function payoutItemId(): string {
  return `pai_${crypto.randomUUID()}`
}

function nowIso(): string {
  return new Date().toISOString()
}

/** Thrown on invalid input (bad dates, amounts, unknown references). */
export class PayoutValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "PayoutValidationError"
  }
}

/**
 * Thrown when an operation is applied to a run in a status that does not
 * allow it (the API answers 409). The state machine:
 *
 *   draft → processing → completed   (every item resolved `paid`)
 *                ↘        → failed     (≥1 item failed; retryable)
 *   failed → processing → completed | failed   (retry re-evaluates failed items)
 *   completed — terminal
 *
 * Items may only be added while the run is `draft`. `processing` is
 * transient — `processRun` resolves it synchronously, so it is never
 * observable between calls.
 */
export class PayoutTransitionError extends Error {
  constructor(
    public readonly action: "add-item" | "process",
    public readonly from: PayoutRunStatus,
  ) {
    super(`Cannot ${action} a payout run in status "${from}".`)
    this.name = "PayoutTransitionError"
  }
}

function itemsOf(runId: string): PayoutItem[] {
  return itemsByRun.get(runId) ?? []
}

/**
 * Set of commission ids already claimed by a `pending` or `paid` payout item
 * anywhere in the store. `failed` items release their claims so corrected
 * runs can pick the commissions up again. `excludeItemId` skips the item
 * currently being evaluated so its own claim does not block it.
 */
function claimedCommissionIds(excludeItemId?: string): Set<string> {
  const claimed = new Set<string>()
  for (const items of itemsByRun.values()) {
    for (const item of items) {
      if (item.status === "failed") continue
      if (item.id === excludeItemId) continue
      for (const id of item.commissionIds) claimed.add(id)
    }
  }
  return claimed
}

export interface CreatePayoutRunInput {
  /** ISO date or datetime marking the start of the commission period. */
  periodStart: string
  /** ISO date or datetime marking the end of the commission period. */
  periodEnd: string
}

/**
 * Creates a `draft` payout run covering `[periodStart, periodEnd)`. Both
 * bounds must parse as dates, `periodStart` must be before `periodEnd`, and
 * the span may not exceed `PAYOUT_PERIOD_MAX_DAYS`. Throws
 * `PayoutValidationError` otherwise, or when the run store is full.
 */
export function createPayoutRun(input: CreatePayoutRunInput): PayoutRun {
  const start = Date.parse(input.periodStart)
  const end = Date.parse(input.periodEnd)
  if (Number.isNaN(start) || Number.isNaN(end)) {
    throw new PayoutValidationError("periodStart and periodEnd must be valid dates.")
  }
  if (start >= end) {
    throw new PayoutValidationError("periodStart must be before periodEnd.")
  }
  if (end - start > PAYOUT_PERIOD_MAX_DAYS * 24 * 60 * 60 * 1000) {
    throw new PayoutValidationError(
      `The payout period may span at most ${PAYOUT_PERIOD_MAX_DAYS} days.`,
    )
  }
  if (runs.size >= PAYOUT_RUNS_STORE_MAX) {
    throw new PayoutValidationError(
      "The payout run store is currently at capacity. Try again later.",
    )
  }

  const run: PayoutRun = {
    id: payoutRunId(),
    status: "draft",
    periodStart: new Date(start).toISOString(),
    periodEnd: new Date(end).toISOString(),
    createdAt: nowIso(),
  }
  runs.set(run.id, run)
  itemsByRun.set(run.id, [])
  return run
}

export interface AddPayoutItemInput {
  affiliateId: string
  amountCents: number
  commissionIds?: string[]
}

/**
 * Adds a `pending` item to a `draft` run. `amountCents` must be a positive
 * integer. Each `commissionIds` entry must reference an existing
 * `approved` commission belonging to the same `affiliateId`, and no
 * commission may be claimed by more than one pending/paid item across all
 * runs. Throws `PayoutValidationError` on bad input,
 * `PayoutTransitionError` when the run is not `draft`, or when the per-run
 * item bound is reached.
 */
export function addItemToRun(runId: string, input: AddPayoutItemInput): PayoutItem {
  const run = runs.get(runId)
  if (!run) throw new PayoutValidationError("Payout run not found.")
  if (run.status !== "draft") throw new PayoutTransitionError("add-item", run.status)

  const affiliateId = input.affiliateId.trim()
  if (!affiliateId) throw new PayoutValidationError("An affiliate id is required.")
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
    throw new PayoutValidationError("amountCents must be a positive integer.")
  }
  const commissionIds = [
    ...new Set((input.commissionIds ?? []).map((id) => id.trim()).filter(Boolean)),
  ]
  if (commissionIds.length > PAYOUT_ITEM_MAX_COMMISSIONS) {
    throw new PayoutValidationError(
      `An item may reference at most ${PAYOUT_ITEM_MAX_COMMISSIONS} commissions.`,
    )
  }

  const items = itemsOf(runId)
  if (items.length >= PAYOUT_ITEMS_PER_RUN_MAX) {
    throw new PayoutValidationError("This payout run has reached its item limit.")
  }

  if (commissionIds.length > 0) {
    // The ledger is bounded (10k records); a linear scan is acceptable and
    // keeps payouts.ts decoupled from commissions.ts internals.
    const byId = new Map(listCommissions().map((record) => [record.id, record]))
    const claimed = claimedCommissionIds()
    for (const id of commissionIds) {
      const commission = byId.get(id)
      if (!commission) {
        throw new PayoutValidationError(`commissionIds entry "${id}" does not exist.`)
      }
      if (commission.affiliateId !== affiliateId) {
        throw new PayoutValidationError(`Commission "${id}" belongs to a different affiliate.`)
      }
      if (commission.status !== "approved") {
        throw new PayoutValidationError(
          `Commission "${id}" is "${commission.status}" — only approved commissions are payable.`,
        )
      }
      if (claimed.has(id)) {
        throw new PayoutValidationError(
          `Commission "${id}" is already claimed by another payout item.`,
        )
      }
    }
  }

  const item: PayoutItem = {
    id: payoutItemId(),
    payoutId: runId,
    affiliateId,
    amountCents: input.amountCents,
    status: "pending",
    commissionIds,
  }
  items.push(item)
  return item
}

/**
 * SIMULATED processing — NO REAL MONEY MOVES.
 *
 * Transitions the run `draft|failed → processing → completed|failed` and
 * resolves every outstanding item deterministically:
 *
 *   - `failed` ("No payout method configured.") when the affiliate has no
 *     stored payout settings or `method` is `null`;
 *   - `failed` ("Amount exceeds the simulated payout limit.") when
 *     `amountCents > SIMULATED_PAYOUT_ITEM_MAX_CENTS`;
 *   - `failed` when a linked commission is no longer `approved` or is
 *     claimed by another pending/paid item (payment-time revalidation);
 *   - `paid` otherwise.
 *
 * On a retry (`failed → processing`) only items still `failed` are
 * re-evaluated — `paid` items are never touched, so fixing payout settings
 * and reprocessing cannot double-pay. The run ends `completed` when no item
 * failed, `failed` when at least one did; `completedAt` is set either way.
 * `completed` runs are terminal — `PayoutTransitionError` is thrown.
 */
export function processRun(runId: string): PayoutRun {
  const run = runs.get(runId)
  if (!run) throw new PayoutValidationError("Payout run not found.")
  if (run.status !== "draft" && run.status !== "failed") {
    throw new PayoutTransitionError("process", run.status)
  }

  const retrying = run.status === "failed"
  run.status = "processing"

  const items = itemsOf(runId)
  for (const item of items) {
    // First pass: every pending item. Retry pass: only failed items (paid
    // items are final; pending cannot coexist with a failed run, but the
    // check keeps the rule explicit).
    const outstanding = retrying ? item.status === "failed" : item.status === "pending"
    if (!outstanding) continue

    const settings = settingsByAffiliate.get(item.affiliateId)
    if (!settings || settings.method === null) {
      item.status = "failed"
      item.failureReason = "No payout method configured."
      delete item.paidAt
      continue
    }
    if (item.amountCents > SIMULATED_PAYOUT_ITEM_MAX_CENTS) {
      item.status = "failed"
      item.failureReason = "Amount exceeds the simulated payout limit."
      delete item.paidAt
      continue
    }

    // Payment-time revalidation (add-time checks go stale): every linked
    // commission must STILL be approved and unclaimed by another
    // pending/paid item in any run — including this run's other items and
    // items added to later runs after this item released its claim on
    // failure. An item pays only when ALL its commissionIds pass.
    if (item.commissionIds.length > 0) {
      const byId = new Map(listCommissions().map((record) => [record.id, record]))
      const claimedByOthers = claimedCommissionIds(item.id)
      let conflict: string | null = null
      for (const id of item.commissionIds) {
        const commission = byId.get(id)
        if (!commission || commission.status !== "approved") {
          conflict = `Commission ${id} no longer approved.`
          break
        }
        if (claimedByOthers.has(id)) {
          conflict = `Commission ${id} is already claimed by another payout item.`
          break
        }
      }
      if (conflict) {
        item.status = "failed"
        item.failureReason = conflict
        delete item.paidAt
        continue
      }
    }

    item.status = "paid"
    item.paidAt = nowIso()
    delete item.failureReason
  }

  const anyFailed = items.some((item) => item.status === "failed")
  run.status = anyFailed ? "failed" : "completed"
  run.completedAt = nowIso()
  return run
}

/** Admin listing, newest first. `status` filters to a single status. */
export function listRuns(status?: PayoutRunStatus): PayoutRun[] {
  return [...runs.values()]
    .reverse()
    .filter((run) => status === undefined || run.status === status)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export interface PayoutRunDetail {
  run: PayoutRun
  items: PayoutItem[]
}

/** One run plus its items, or null when the id is unknown. */
export function getRun(runId: string): PayoutRunDetail | null {
  const run = runs.get(runId)
  if (!run) return null
  return { run, items: [...itemsOf(runId)] }
}

/** The affiliate's stored payout settings, or null when never configured. */
export function getPayoutSettings(affiliateId: string): AffiliatePayoutSettings | null {
  return settingsByAffiliate.get(affiliateId.trim()) ?? null
}

export interface PayoutSettingsInput {
  method?: PayoutMethod | null
  minimumThresholdCents?: number
  schedule?: PayoutSchedule
}

/**
 * Creates or updates an affiliate's payout settings (partial update — only
 * provided fields change). `method` accepts a `PAYOUT_METHODS` label or
 * `null` to clear it; there is deliberately no way to store account numbers
 * or credentials. Throws `PayoutValidationError` on bad input.
 */
export function upsertPayoutSettings(
  affiliateId: string,
  input: PayoutSettingsInput,
): AffiliatePayoutSettings {
  const id = affiliateId.trim()
  if (!id) throw new PayoutValidationError("An affiliate id is required.")

  const existing = settingsByAffiliate.get(id)
  const next: AffiliatePayoutSettings = {
    affiliateId: id,
    method: existing?.method ?? null,
    minimumThresholdCents: existing?.minimumThresholdCents ?? DEFAULT_MINIMUM_THRESHOLD_CENTS,
    schedule: existing?.schedule ?? "manual",
  }

  if (input.method !== undefined) {
    if (input.method !== null && !PAYOUT_METHODS.includes(input.method)) {
      throw new PayoutValidationError(
        `method must be one of: ${PAYOUT_METHODS.join(", ")}, or null.`,
      )
    }
    next.method = input.method
  }
  if (input.minimumThresholdCents !== undefined) {
    if (
      !Number.isInteger(input.minimumThresholdCents) ||
      input.minimumThresholdCents < 0 ||
      input.minimumThresholdCents > SIMULATED_PAYOUT_ITEM_MAX_CENTS
    ) {
      throw new PayoutValidationError("minimumThresholdCents must be a non-negative integer.")
    }
    next.minimumThresholdCents = input.minimumThresholdCents
  }
  if (input.schedule !== undefined) {
    if (!PAYOUT_SCHEDULES.includes(input.schedule)) {
      throw new PayoutValidationError(`schedule must be one of: ${PAYOUT_SCHEDULES.join(", ")}.`)
    }
    next.schedule = input.schedule
  }

  settingsByAffiliate.set(id, next)
  return next
}

/** Test hook: clears all payout runs, items, and settings. */
export function resetPayoutsForTests(): void {
  runs.clear()
  itemsByRun.clear()
  settingsByAffiliate.clear()
}
