import { z } from "zod"

/**
 * Workspace billing — DEVELOPMENT seam.
 *
 * In-memory, per-process store for workspace plan/subscription state. Like
 * {@link MemoryAuthBackend}, {@link workspace-settings}, and
 * {@link workspace-audit} this loses state on restart and does not scale
 * past one process; production MUST persist these rows.
 *
 * NO REAL PAYMENTS: there is no payment processor integration anywhere in
 * this codebase and none is planned for this seam. `plan`, `status`, and
 * `currentPeriodEnd` are recorded locally only — "upgrading" a plan does
 * not charge anyone, and `past_due`/`canceled` are inert labels until a
 * billing provider lands. The UI must say so honestly.
 *
 * Seat limits are enforced against the auth backend roster
 * (`listWorkspaceMembers`) via {@link checkSeatLimit}; `seatCount` on the
 * stored record is a snapshot taken at the last billing write, useful for
 * audit/display without a live roster lookup.
 */

export const BILLING_PLAN_IDS = ["free", "pro", "business"] as const
export type BillingPlanId = (typeof BILLING_PLAN_IDS)[number]

export const BILLING_STATUSES = ["active", "trialing", "past_due", "canceled"] as const
export type BillingStatus = (typeof BILLING_STATUSES)[number]

export type BillingPlan = {
  id: BillingPlanId
  name: string
  /** Human-readable price copy, e.g. "$12 per member / month". */
  priceLabel: string
  /** Maximum workspace members allowed on this plan. */
  seatLimit: number
  /** One-line summary shown on plan cards. */
  summary: string
}

export const WORKSPACE_BILLING_PLANS: Record<BillingPlanId, BillingPlan> = {
  free: {
    id: "free",
    name: "Free",
    priceLabel: "$0",
    seatLimit: 5,
    summary: "For trying Spindle with a small team.",
  },
  pro: {
    id: "pro",
    name: "Pro",
    priceLabel: "$12 per member / month",
    seatLimit: 25,
    summary: "For growing teams that need more seats and support.",
  },
  business: {
    id: "business",
    name: "Business",
    priceLabel: "$40 per member / month",
    seatLimit: 200,
    summary: "For larger organizations with advanced needs.",
  },
}

/** Plan catalog in display order (free → business). */
export function billingPlanCatalog(): BillingPlan[] {
  return BILLING_PLAN_IDS.map((id) => WORKSPACE_BILLING_PLANS[id])
}

export type WorkspaceBilling = {
  plan: BillingPlanId
  status: BillingStatus
  /** ISO 8601 timestamp for the end of the current billing period, if set. */
  currentPeriodEnd: string | null
  /** Member count snapshot from the last billing write; null until then. */
  seatCount: number | null
}

export const DEFAULT_WORKSPACE_BILLING: WorkspaceBilling = {
  plan: "free",
  status: "active",
  currentPeriodEnd: null,
  seatCount: null,
}

/**
 * ISO-8601-ish date or datetime: `YYYY-MM-DD` optionally followed by a
 * `T`/space-separated time with optional seconds, fractional seconds, and a
 * `Z`/`±hh:mm` offset. Mirrors the audit route's {@link ISO_DATE_LIKE} so
 * values like `"March 1, 2026"` that `Date.parse` accepts are still
 * rejected as non-ISO.
 */
const ISO_DATE_LIKE =
  /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/

function isIsoDate(value: string): boolean {
  return ISO_DATE_LIKE.test(value) && !Number.isNaN(Date.parse(value))
}

const isoDateSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine(isIsoDate, { message: "Must be a valid ISO 8601 date or timestamp." })

/**
 * API-facing patch: clients may only change plan/status/period end.
 * `confirmSeatOverflow` is a one-shot acknowledgement flag — it is consumed
 * by the PATCH route (never stored) to confirm a downgrade whose seatLimit
 * is below the current member count.
 */
export const workspaceBillingPatchSchema = z
  .object({
    plan: z.enum(BILLING_PLAN_IDS).optional(),
    status: z.enum(BILLING_STATUSES).optional(),
    currentPeriodEnd: isoDateSchema.nullable().optional(),
    confirmSeatOverflow: z.boolean().optional(),
  })
  .strict()

export type WorkspaceBillingPatch = z.infer<typeof workspaceBillingPatchSchema>
/** Stored-record patch fields (everything except the confirm flag). */
type BillingRecordPatch = Omit<WorkspaceBillingPatch, "confirmSeatOverflow">

/** Internal patch additionally accepts the server-side seatCount snapshot. */
const updateSchema = z
  .object({
    plan: z.enum(BILLING_PLAN_IDS).optional(),
    status: z.enum(BILLING_STATUSES).optional(),
    currentPeriodEnd: isoDateSchema.nullable().optional(),
    seatCount: z.number().int().min(0).max(1_000_000).nullable().optional(),
  })
  .strict()

const store = new Map<string, WorkspaceBilling>()

/** Current billing record for a workspace; defaults to free/active. */
export function getBilling(workspaceId: string): WorkspaceBilling {
  return store.get(workspaceId) ?? { ...DEFAULT_WORKSPACE_BILLING }
}

/**
 * Merges `patch` over the stored billing record; returns the new full
 * record. Throws a ZodError on invalid input — callers should validate
 * first (the API route uses {@link workspaceBillingPatchSchema}).
 */
export function updateBilling(
  workspaceId: string,
  patch: BillingRecordPatch & { seatCount?: number | null },
): WorkspaceBilling {
  const parsed = updateSchema.parse(patch)
  const next: WorkspaceBilling = { ...getBilling(workspaceId), ...parsed }
  store.set(workspaceId, next)
  return next
}

/**
 * Seat-limit check for a workspace. `memberCount` is the live roster size
 * (from `backend.listWorkspaceMembers`); the limit comes from the stored
 * plan. `allowed` is true when the roster fits within the plan's seatLimit.
 */
export function checkSeatLimit(
  workspaceId: string,
  memberCount: number,
): { allowed: boolean; limit: number; current: number } {
  const limit = WORKSPACE_BILLING_PLANS[getBilling(workspaceId).plan].seatLimit
  return { allowed: memberCount <= limit, limit, current: memberCount }
}

/** TEST-ONLY: clears all stored billing records. */
export function resetWorkspaceBillingForTests(): void {
  store.clear()
}
