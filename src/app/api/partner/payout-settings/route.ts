import { z } from "zod"

import { getAffiliateByUserId } from "@/lib/affiliate"
import {
  AUTH_LIMITS,
  authRateLimited,
  clientIp,
  createAuthRateLimiter,
} from "@/lib/auth-endpoint-rate-limit"
import { fail, isSameOriginRequest, ok } from "@/lib/auth/http"
import { resolveAffiliateCaller } from "@/app/api/affiliate/caller"
import {
  PAYOUT_METHODS,
  PAYOUT_SCHEDULES,
  PayoutValidationError,
  getPayoutSettings,
  upsertPayoutSettings,
} from "@/lib/payouts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * /api/partner/payout-settings
 *
 * GET — the signed-in partner's own payout settings (method label,
 *       minimum threshold, schedule). Returns `settings: null` when the
 *       partner has never configured payouts.
 * PUT — create or partially update those settings:
 *       `{ method?: "paypal" | "bank_transfer" | "manual" | null,
 *          minimumThresholdCents?: int ≥ 0, schedule?: "weekly" | "monthly" |
 *          "manual" }`.
 *
 * ONLY labels and thresholds are stored — there is deliberately no way to
 * submit account numbers, emails-as-destinations, or credentials through
 * this endpoint. `method: null` clears the configured destination.
 *
 * Identity resolves exactly like `/api/partner/commissions` and
 * `/api/partner/portal` (`../affiliate/caller.ts`). Any affiliate account
 * status may read/write its own settings (a suspended partner keeps control
 * of where future payouts would go). No account → 404, no session → 401.
 *
 * SIMULATED ONLY: these settings feed the deterministic simulator in
 * `src/lib/payouts.ts`; no money moves.
 */

const limiter = createAuthRateLimiter(AUTH_LIMITS.publicRead)

const putSchema = z
  .object({
    method: z.enum(PAYOUT_METHODS).nullable().optional(),
    minimumThresholdCents: z
      .number()
      .int("minimumThresholdCents must be an integer.")
      .nonnegative("minimumThresholdCents must be non-negative.")
      .optional(),
    schedule: z.enum(PAYOUT_SCHEDULES).optional(),
  })
  .refine(
    (value) =>
      value.method !== undefined ||
      value.minimumThresholdCents !== undefined ||
      value.schedule !== undefined,
    { message: "Provide at least one setting to update." },
  )

async function resolvePartner(request: Request) {
  if (!limiter.check(clientIp(request))) return authRateLimited()

  const caller = await resolveAffiliateCaller(request)
  if (!caller) {
    return fail(401, "unauthenticated", "Sign in to manage payout settings.")
  }
  const account = getAffiliateByUserId(caller.userId)
  if (!account) {
    return fail(404, "not_found", "No affiliate account is linked to your session.")
  }
  return account
}

export async function GET(request: Request) {
  const account = await resolvePartner(request)
  if (account instanceof Response) return account

  return ok({ settings: getPayoutSettings(account.id) })
}

export async function PUT(request: Request) {
  if (!isSameOriginRequest(request)) {
    return fail(403, "forbidden", "Cross-origin request blocked.")
  }

  const account = await resolvePartner(request)
  if (account instanceof Response) return account

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return fail(400, "invalid_request", "Request body must be JSON.")
  }

  const parsed = putSchema.safeParse(body)
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "Invalid request."
    return fail(400, "invalid_request", message)
  }

  try {
    const settings = upsertPayoutSettings(account.id, parsed.data)
    return ok({ settings })
  } catch (error) {
    if (error instanceof PayoutValidationError) {
      return fail(400, "invalid_request", error.message)
    }
    throw error
  }
}
