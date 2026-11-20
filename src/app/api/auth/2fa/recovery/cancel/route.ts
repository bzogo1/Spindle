import { getAuthBackend } from "@/lib/auth/backend"
import { accessTokenFromRequest, fail, isSameOriginRequest, ok } from "@/lib/auth/http"
import { getTotpRecoveryStore, recordRecoveryAuditEvent } from "@/lib/auth/totp-recovery"
import { auditContextFromRequest } from "@/lib/auth/audit"
import { createRateLimiter, clientIp } from "@/lib/site-forms"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const limiter = createRateLimiter({ limit: 10, windowMs: 60 * 1000 })

/**
 * POST /api/auth/2fa/recovery/cancel — aborts a pending or cooling-down
 * recovery. This is the safety hatch for an unauthorized request: cancelling
 * during the 72h cooldown keeps 2FA fully enabled.
 */
export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return fail(403, "forbidden", "Cross-origin request blocked.")
  if (!limiter.check(clientIp(request))) {
    return fail(429, "rate_limited", "Too many attempts. Try again later.")
  }

  const access = accessTokenFromRequest(request)
  if (!access) return fail(401, "unauthenticated", "Sign in required.")

  const backend = getAuthBackend()
  const user = await backend.getUserById(access.uid)
  if (!user) return fail(401, "unauthenticated", "Sign in required.")

  if (!getTotpRecoveryStore().cancel(user.id)) {
    return fail(404, "no_active_recovery", "No recovery is in progress.")
  }

  recordRecoveryAuditEvent("cancelled", {
    userId: user.id,
    email: user.email,
    ...auditContextFromRequest(request),
  })
  return ok({ state: "cancelled" })
}
