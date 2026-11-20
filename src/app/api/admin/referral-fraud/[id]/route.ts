import { NextResponse } from "next/server"
import { z } from "zod"

import { requireAdmin } from "@/lib/admin-guard"
import {
  AUTH_LIMITS,
  authRateLimited,
  clientIp,
  createAuthRateLimiter,
} from "@/lib/auth-endpoint-rate-limit"
import { fail, ok } from "@/lib/auth/http"
import {
  flagJson,
  getFlag,
  isReferralFraudFlagStatus,
  REFERRAL_FRAUD_FLAG_STATUSES,
  ReferralFraudError,
  reviewFlag,
  type ReferralFraudFlagStatus,
} from "@/lib/referral-fraud"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * /api/admin/referral-fraud/[id]
 *
 * GET   — one flagged referral.
 * PATCH — `{ status: "cleared" | "confirmed_fraud" | "pending" }`; stamps
 *         `reviewedBy` with the verified admin email and `reviewedAt`.
 *
 * Admin-only via `requireAdmin`. Flags live in the in-memory dev seam in
 * `src/lib/referral-fraud.ts`.
 */

const limiter = createAuthRateLimiter(AUTH_LIMITS.publicRead)

const patchSchema = z.object({
  status: z.string().trim().min(1),
})

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(request: Request, context: RouteContext) {
  if (!limiter.check(clientIp(request))) return authRateLimited()

  const admin = await requireAdmin(request)
  if (admin instanceof NextResponse) return admin

  const { id } = await context.params
  const flag = getFlag(id)
  if (!flag) return fail(404, "not_found", "Flag not found.")
  return ok({ flag: flagJson(flag) })
}

export async function PATCH(request: Request, context: RouteContext) {
  if (!limiter.check(clientIp(request))) return authRateLimited()

  const admin = await requireAdmin(request)
  if (admin instanceof NextResponse) return admin

  const { id } = await context.params

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return fail(400, "invalid_request", "Expected a JSON body.")
  }

  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "Invalid request."
    return fail(400, "invalid_request", message)
  }

  const { status } = parsed.data
  if (!isReferralFraudFlagStatus(status)) {
    return fail(
      400,
      "invalid_request",
      `status must be one of: ${REFERRAL_FRAUD_FLAG_STATUSES.join(", ")}.`,
    )
  }

  try {
    const flag = reviewFlag(id, status as ReferralFraudFlagStatus, admin.email)
    return ok({ flag: flagJson(flag) })
  } catch (error) {
    if (error instanceof ReferralFraudError) {
      const code = error.code === "not_found" ? 404 : 400
      return fail(code, error.code === "not_found" ? "not_found" : "invalid_request", error.message)
    }
    return fail(500, "internal", "Could not update the flag.")
  }
}
