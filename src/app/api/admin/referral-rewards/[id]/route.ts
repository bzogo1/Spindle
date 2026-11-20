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
import { getReward, ReferralRewardError, revokeReward, rewardJson } from "@/lib/referral-rewards"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * /api/admin/referral-rewards/[id]
 *
 * GET   — one reward record.
 * PATCH — `{ action: "revoke", reason? }`; `pending|issued → revoked`
 *         (revoked is terminal). `reason` is stored for audit.
 *
 * Admin-only via `requireAdmin`; PATCH is same-origin enforced and both
 * verbs are rate limited. Revocation is a ledger-only clawback — no
 * payout pipeline exists to reverse.
 */

const limiter = createAuthRateLimiter(AUTH_LIMITS.publicRead)

const patchSchema = z.object({
  action: z.literal("revoke"),
  reason: z.string().trim().max(500).optional(),
})

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(request: Request, context: RouteContext) {
  if (!limiter.check(clientIp(request))) return authRateLimited()

  const admin = await requireAdmin(request)
  if (admin instanceof NextResponse) return admin

  const { id } = await context.params
  const reward = getReward(id)
  if (!reward) return fail(404, "not_found", "Reward not found.")
  return ok({ reward: rewardJson(reward) })
}

export async function PATCH(request: Request, context: RouteContext) {
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

  try {
    const reward = revokeReward(id, parsed.data.reason)
    return ok({ reward: rewardJson(reward) })
  } catch (error) {
    if (error instanceof ReferralRewardError) {
      const status =
        error.code === "not_found" ? 404 : error.code === "invalid_transition" ? 409 : 400
      return fail(status, error.code === "not_found" ? "not_found" : error.code, error.message)
    }
    return fail(500, "internal", "Could not revoke the reward.")
  }
}
