import { NextResponse } from "next/server"
import { z } from "zod"

import { requireAdmin } from "@/lib/admin-guard"
import {
  CommissionTransitionError,
  approveCommission,
  markCommissionPaid,
  voidCommission,
} from "@/lib/commissions"
import {
  AUTH_LIMITS,
  authRateLimited,
  clientIp,
  createAuthRateLimiter,
} from "@/lib/auth-endpoint-rate-limit"
import { fail, isSameOriginRequest, ok } from "@/lib/auth/http"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * /api/admin/commissions/[id]
 *
 * PATCH — transition one commission: `{ action: "approve" | "void" |
 *         "mark-paid" }`. The status machine lives in
 *         `src/lib/commissions.ts` (`COMMISSION_TRANSITIONS`):
 *         pending → approved → paid, with void allowed from pending or
 *         approved. `paid` and `void` are terminal; anything else is a 409,
 *         unknown ids 404.
 *
 * `mark-paid` is a LEDGER status only — no money moves. Admin-only via
 * `requireAdmin`, same-origin enforced, rate limited.
 */

const limiter = createAuthRateLimiter(AUTH_LIMITS.publicRead)

const patchSchema = z.object({
  action: z.enum(["approve", "void", "mark-paid"]),
})

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
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

  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "Invalid request."
    return fail(400, "invalid_request", message)
  }

  const { action } = parsed.data
  let commission
  try {
    commission =
      action === "approve"
        ? approveCommission(id)
        : action === "void"
          ? voidCommission(id)
          : markCommissionPaid(id)
  } catch (error) {
    if (error instanceof CommissionTransitionError) {
      return fail(409, "invalid_transition", error.message)
    }
    throw error
  }

  if (!commission) {
    return fail(404, "not_found", "Commission not found.")
  }
  return ok({ commission })
}
