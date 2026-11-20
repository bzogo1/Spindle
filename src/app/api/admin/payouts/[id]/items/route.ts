import { NextResponse } from "next/server"
import { z } from "zod"

import { requireAdmin } from "@/lib/admin-guard"
import {
  AUTH_LIMITS,
  authRateLimited,
  clientIp,
  createAuthRateLimiter,
} from "@/lib/auth-endpoint-rate-limit"
import { fail, isSameOriginRequest, ok } from "@/lib/auth/http"
import {
  PAYOUT_ITEM_MAX_COMMISSIONS,
  PayoutTransitionError,
  PayoutValidationError,
  addItemToRun,
  getRun,
} from "@/lib/payouts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * /api/admin/payouts/[id]/items
 *
 * POST — add a `pending` item to a `draft` run:
 *        `{ affiliateId, amountCents, commissionIds? }`. `amountCents` must
 *        be a positive integer; each `commissionIds` entry must reference
 *        an `approved` commission belonging to the same affiliate and not
 *        already claimed by another pending/paid item. Items may only be
 *        added while the run is `draft` — once processing starts the run
 *        is immutable (409); unknown ids 404. Processing stays on
 *        `POST /api/admin/payouts/[id]` with `{ action: "process" }`.
 *
 * SIMULATED ONLY: no money moves. See `src/lib/payouts.ts`.
 *
 * Admin-only via `requireAdmin`, same-origin enforced, rate limited.
 */

const limiter = createAuthRateLimiter(AUTH_LIMITS.publicRead)

const postSchema = z.object({
  affiliateId: z.string().trim().min(1, "affiliateId is required."),
  amountCents: z
    .number()
    .int("amountCents must be an integer.")
    .positive("amountCents must be positive."),
  commissionIds: z.array(z.string().trim().min(1)).max(PAYOUT_ITEM_MAX_COMMISSIONS).optional(),
})

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isSameOriginRequest(request)) {
    return fail(403, "forbidden", "Cross-origin request blocked.")
  }
  if (!limiter.check(clientIp(request))) return authRateLimited()

  const admin = await requireAdmin(request)
  if (admin instanceof NextResponse) return admin

  const { id } = await context.params

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return fail(400, "invalid_request", "Request body must be JSON.")
  }

  const parsed = postSchema.safeParse(body)
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "Invalid request."
    return fail(400, "invalid_request", message)
  }

  if (!getRun(id)) {
    return fail(404, "not_found", "Payout run not found.")
  }

  try {
    const item = addItemToRun(id, parsed.data)
    return ok({ item })
  } catch (error) {
    if (error instanceof PayoutTransitionError) {
      return fail(409, "invalid_transition", error.message)
    }
    if (error instanceof PayoutValidationError) {
      return fail(400, "invalid_request", error.message)
    }
    throw error
  }
}
