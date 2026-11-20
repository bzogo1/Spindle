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
  issueRewardForAttribution,
  isReferralRewardStatus,
  isReferralRewardType,
  listRewardsForAdmin,
  REFERRAL_REWARD_STATUSES,
  REFERRAL_REWARD_TYPES,
  ReferralRewardError,
  rewardJson,
  rewardLabel,
  rewardStats,
} from "@/lib/referral-rewards"
import { ReferralProgramError } from "@/lib/referral-program"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * /api/admin/referral-rewards
 *
 * GET  — the reward ledger across every referrer, newest first. Filters:
 *        `?status=` (pending|issued|revoked), `?type=` (credit|badge|
 *        trial_extension), `?referrerUserId=`, `?attributionId=`, plus
 *        `?limit=` / `?offset=` pagination. Returns `{ rewards, total,
 *        stats, rewardLabel }`.
 * POST — issue a reward for a qualified attribution:
 *        `{ attributionId, type?, amountCents?, reason? }`. The attribution
 *        must exist, be `qualified` (or already `rewarded` with no reward
 *        record — the re-issue seam), and not be fraud-flagged; issuance
 *        also advances the attribution via `markRewarded`
 *        (`maxRewardsPerUser` enforced). At most one reward per
 *        attribution — repeats return 409.
 *
 * Admin-only via `requireAdmin`; POST is same-origin enforced and both
 * verbs are rate limited. Rewards are reporting records only — there is
 * no payout pipeline (see `src/lib/referral-rewards.ts`).
 */

const limiter = createAuthRateLimiter(AUTH_LIMITS.publicRead)

const issueSchema = z.object({
  attributionId: z.string().trim().min(1).max(120),
  type: z.enum(REFERRAL_REWARD_TYPES).optional(),
  amountCents: z.number().int().min(0).nullable().optional(),
  reason: z.string().trim().max(500).optional(),
})

function parseIntParam(value: string | null): number | undefined {
  if (value === null) return undefined
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : undefined
}

function rewardErrorStatus(code: ReferralRewardError["code"]): number {
  switch (code) {
    case "not_found":
      return 404
    case "conflict":
    case "invalid_transition":
      return 409
    case "limit":
      // Store/quota exhaustion is not transient — 503 would wrongly
      // suggest a retry later helps. 409 Conflict like the other
      // non-retryable ledger states.
      return 409
    case "fraud_flagged":
      return 403
    default:
      return 400
  }
}

export async function GET(request: Request) {
  if (!limiter.check(clientIp(request))) return authRateLimited()

  const admin = await requireAdmin(request)
  if (admin instanceof NextResponse) return admin

  const params = new URL(request.url).searchParams
  const statusParam = params.get("status")?.trim() ?? ""
  if (statusParam && !isReferralRewardStatus(statusParam)) {
    return fail(
      400,
      "invalid_request",
      `status must be one of: ${REFERRAL_REWARD_STATUSES.join(", ")}.`,
    )
  }
  const typeParam = params.get("type")?.trim() ?? ""
  if (typeParam && !isReferralRewardType(typeParam)) {
    return fail(400, "invalid_request", `type must be one of: ${REFERRAL_REWARD_TYPES.join(", ")}.`)
  }

  const limit = parseIntParam(params.get("limit"))
  const offset = parseIntParam(params.get("offset"))
  if (
    (params.get("limit") !== null && limit === undefined) ||
    (params.get("offset") !== null && offset === undefined)
  ) {
    return fail(400, "invalid_request", "limit and offset must be integers.")
  }

  const referrerUserId = params.get("referrerUserId")?.trim() ?? ""
  const attributionIdParam = params.get("attributionId")?.trim() ?? ""
  const filter = {
    ...(statusParam ? { status: statusParam as (typeof REFERRAL_REWARD_STATUSES)[number] } : {}),
    ...(typeParam ? { type: typeParam as (typeof REFERRAL_REWARD_TYPES)[number] } : {}),
    ...(referrerUserId ? { referrerUserId } : {}),
    ...(attributionIdParam ? { attributionId: attributionIdParam } : {}),
    ...(limit !== undefined ? { limit } : {}),
    ...(offset !== undefined ? { offset } : {}),
  }

  const result = listRewardsForAdmin(filter)
  return ok({
    rewards: result.items.map(rewardJson),
    total: result.total,
    stats: rewardStats(filter),
    rewardLabel: rewardLabel(),
  })
}

export async function POST(request: Request) {
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

  const parsed = issueSchema.safeParse(body)
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "Invalid reward issuance."
    return fail(400, "invalid_request", message)
  }

  try {
    const reward = issueRewardForAttribution(parsed.data.attributionId, {
      ...(parsed.data.type ? { type: parsed.data.type } : {}),
      ...(parsed.data.amountCents !== undefined ? { amountCents: parsed.data.amountCents } : {}),
      ...(parsed.data.reason ? { reason: parsed.data.reason } : {}),
    })
    return ok({ reward: rewardJson(reward) })
  } catch (error) {
    if (error instanceof ReferralRewardError) {
      return fail(
        rewardErrorStatus(error.code),
        error.code === "not_found" ? "not_found" : error.code,
        error.message,
      )
    }
    if (error instanceof ReferralProgramError) {
      // markRewarded failures (e.g. maxRewardsPerUser) propagate.
      const status = error.code === "not_found" ? 404 : error.code === "invalid" ? 400 : 409
      return fail(status, error.code, error.message)
    }
    return fail(500, "internal", "Could not issue the reward.")
  }
}
