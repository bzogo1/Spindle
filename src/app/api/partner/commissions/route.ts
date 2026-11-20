import { getAffiliateByUserId } from "@/lib/affiliate"
import { commissionTotalsForAffiliate, listCommissions } from "@/lib/commissions"
import {
  AUTH_LIMITS,
  authRateLimited,
  clientIp,
  createAuthRateLimiter,
} from "@/lib/auth-endpoint-rate-limit"
import { fail, ok } from "@/lib/auth/http"
import { resolveAffiliateCaller } from "@/app/api/affiliate/caller"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * /api/partner/commissions
 *
 * GET — the signed-in partner's own commission ledger records (newest
 *       first) plus per-status cent totals. Read-only: partners cannot
 *       approve, void, or mark commissions paid — those transitions are
 *       admin-only via `/api/admin/commissions/[id]`.
 *
 * Identity resolves exactly like `/api/partner/portal` and `/api/affiliate`
 * (`../affiliate/caller.ts` — `spindle_at` access cookie, mock session
 * fallback). Any affiliate account status may read its own commissions
 * (unlike the portal, which is active-only): a suspended affiliate keeps
 * visibility into what was already earned. No account → 404, no session →
 * 401.
 *
 * REPORTING ONLY: `paid` is a ledger status — no money moves.
 */

const limiter = createAuthRateLimiter(AUTH_LIMITS.publicRead)

export async function GET(request: Request) {
  if (!limiter.check(clientIp(request))) return authRateLimited()

  const caller = await resolveAffiliateCaller(request)
  if (!caller) {
    return fail(401, "unauthenticated", "Sign in to view your commissions.")
  }

  const account = getAffiliateByUserId(caller.userId)
  if (!account) {
    return fail(404, "not_found", "No affiliate account is linked to your session.")
  }

  return ok({
    commissions: listCommissions({ affiliateId: account.id }),
    totals: commissionTotalsForAffiliate(account.id),
  })
}
