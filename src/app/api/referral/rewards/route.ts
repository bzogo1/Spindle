import {
  AUTH_LIMITS,
  authRateLimited,
  clientIp,
  createAuthRateLimiter,
} from "@/lib/auth-endpoint-rate-limit"
import { fail, ok } from "@/lib/auth/http"
import {
  isReferralRewardStatus,
  isReferralRewardType,
  listRewardsForUser,
  REFERRAL_REWARD_STATUSES,
  REFERRAL_REWARD_TYPES,
  rewardJson,
  rewardLabel,
} from "@/lib/referral-rewards"
import { resolveReferralCaller } from "../caller"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * /api/referral/rewards
 *
 * GET — the signed-in caller's own reward ledger, newest first. Optional
 *       `?status=` (pending|issued|revoked), `?type=` (credit|badge|
 *       trial_extension), `?limit=` / `?offset=` pagination. Returns
 *       `{ rewards, total, rewardLabel }`; `rewardLabel` is the program's
 *       human-readable reward description for display.
 *
 * Auth resolves like `/api/referral/program` (see `../caller.ts`); unlike
 * that route this one is caller-scoped only, so unauthenticated requests
 * get 401. Rewards are reporting records only — no payouts.
 */

const limiter = createAuthRateLimiter(AUTH_LIMITS.publicRead)

function parseIntParam(value: string | null): number | undefined {
  if (value === null) return undefined
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : undefined
}

export async function GET(request: Request) {
  if (!limiter.check(clientIp(request))) return authRateLimited()

  const caller = await resolveReferralCaller(request)
  if (!caller) {
    return fail(401, "unauthenticated", "Sign in to view your rewards.")
  }

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

  const result = listRewardsForUser(caller.userId, {
    ...(statusParam ? { status: statusParam as (typeof REFERRAL_REWARD_STATUSES)[number] } : {}),
    ...(typeParam ? { type: typeParam as (typeof REFERRAL_REWARD_TYPES)[number] } : {}),
    ...(limit !== undefined ? { limit } : {}),
    ...(offset !== undefined ? { offset } : {}),
  })

  return ok({
    rewards: result.items.map(rewardJson),
    total: result.total,
    rewardLabel: rewardLabel(),
  })
}
