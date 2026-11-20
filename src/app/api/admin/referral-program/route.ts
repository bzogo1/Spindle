import { NextResponse } from "next/server"
import { z } from "zod"

import {
  AUTH_LIMITS,
  authRateLimited,
  clientIp,
  createAuthRateLimiter,
} from "@/lib/auth-endpoint-rate-limit"
import { requireAdmin } from "@/lib/admin-guard"
import { fail, isSameOriginRequest, ok } from "@/lib/auth/http"
import {
  getReferralProgramSettings,
  getReferralProgramStats,
  isReferralAttributionStatus,
  listAttributionsForAdmin,
  REFERRAL_ATTRIBUTION_STATUSES,
  REFERRAL_MAX_REWARDS_PER_USER_MAX,
  REFERRAL_REWARD_LABEL_MAX,
  REFERRAL_WINDOW_DAYS_MAX,
  updateReferralProgramSettings,
} from "@/lib/referral-program"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * /api/admin/referral-program
 *
 * GET   — program settings plus program-wide stats and the most recent
 *         attributions for review (`?limit=`/`?offset=` paginate the
 *         attribution list, newest first).
 * PATCH — update program settings `{ enabled?, rewardLabel?,
 *         rewardAmountCents?, maxRewardsPerUser?, windowDays? }`. All fields
 *         optional; provided fields are validated atomically by
 *         `updateReferralProgramSettings`.
 *
 * Admin-only via `requireAdmin`; PATCH is same-origin enforced and both
 * verbs are rate limited. The store is the in-memory dev seam described in
 * `src/lib/referral-program.ts` — there are no real payouts.
 */

const limiter = createAuthRateLimiter(AUTH_LIMITS.publicRead)

const settingsPatchSchema = z
  .object({
    enabled: z.boolean().optional(),
    rewardLabel: z.string().trim().min(1).max(REFERRAL_REWARD_LABEL_MAX).optional(),
    rewardAmountCents: z.number().int().min(0).nullable().optional(),
    maxRewardsPerUser: z.number().int().min(1).max(REFERRAL_MAX_REWARDS_PER_USER_MAX).optional(),
    windowDays: z.number().int().min(1).max(REFERRAL_WINDOW_DAYS_MAX).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "Provide at least one setting to update.",
  })

function parseIntParam(value: string | null): number | undefined {
  if (value === null) return undefined
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : undefined
}

export async function GET(request: Request) {
  if (!limiter.check(clientIp(request))) return authRateLimited()

  const admin = await requireAdmin(request)
  if (admin instanceof NextResponse) return admin

  const params = new URL(request.url).searchParams
  const statusParam = params.get("status")?.trim() ?? ""
  if (statusParam && !isReferralAttributionStatus(statusParam)) {
    return fail(
      400,
      "invalid_request",
      `status must be one of: ${REFERRAL_ATTRIBUTION_STATUSES.join(", ")}.`,
    )
  }

  const limit = parseIntParam(params.get("limit"))
  const offset = parseIntParam(params.get("offset"))
  if (
    (params.get("limit") !== null && limit === undefined) ||
    (params.get("offset") !== null && offset === undefined)
  ) {
    return fail(400, "invalid_request", "limit and offset must be integers.")
  }

  const stats = getReferralProgramStats()
  const status = statusParam
    ? (statusParam as (typeof REFERRAL_ATTRIBUTION_STATUSES)[number])
    : undefined
  const attributions = listAttributionsForAdmin({
    ...(status ? { status } : {}),
    ...(limit !== undefined ? { limit } : {}),
    ...(offset !== undefined ? { offset } : {}),
  })

  return ok({
    settings: getReferralProgramSettings(),
    stats,
    attributions: attributions.items,
    total: attributions.total,
  })
}

export async function PATCH(request: Request) {
  if (!isSameOriginRequest(request)) {
    return fail(403, "forbidden", "Cross-origin request blocked.")
  }
  if (!limiter.check(clientIp(request))) return authRateLimited()

  const admin = await requireAdmin(request)
  if (admin instanceof NextResponse) return admin

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return fail(400, "invalid_request", "Request body must be JSON.")
  }

  const parsed = settingsPatchSchema.safeParse(body)
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "Invalid settings update."
    return fail(400, "invalid_request", message)
  }

  try {
    const settings = updateReferralProgramSettings(parsed.data)
    return ok({ settings })
  } catch (error) {
    return fail(
      400,
      "invalid_request",
      error instanceof Error ? error.message : "Invalid settings update.",
    )
  }
}
