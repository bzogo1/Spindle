import {
  AUTH_LIMITS,
  authRateLimited,
  clientIp,
  createAuthRateLimiter,
} from "@/lib/auth-endpoint-rate-limit"
import { fail, ok } from "@/lib/auth/http"
import { getAffiliateByUserId, statsForAffiliate } from "@/lib/affiliate"
import { resolveAffiliateCaller } from "./caller"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * GET /api/affiliate — the signed-in caller's affiliate program status.
 *
 * Returns `{ affiliate: null }` when the caller never applied, otherwise the
 * account (status, tracking `code`, `commissionRatePct`, `createdAt`) plus
 * aggregated `stats` (`clicks`, `conversions`, `revenueCents`,
 * `commissionCents`) and a ready-to-share `sharePath` pointing at the public
 * click-tracking endpoint. Auth resolves like `/api/profile`; the store is
 * the in-memory dev seam in `src/lib/affiliate.ts`.
 */

const limiter = createAuthRateLimiter(AUTH_LIMITS.publicRead)

export async function GET(request: Request) {
  if (!limiter.check(clientIp(request))) return authRateLimited()

  const caller = await resolveAffiliateCaller(request)
  if (!caller) {
    return fail(401, "unauthenticated", "Sign in to view your affiliate status.")
  }

  const account = getAffiliateByUserId(caller.userId)
  if (!account) {
    return ok({ affiliate: null, stats: null, sharePath: null })
  }

  return ok({
    affiliate: account,
    stats: statsForAffiliate(account),
    sharePath: `/api/affiliate/click/${account.code}`,
  })
}
