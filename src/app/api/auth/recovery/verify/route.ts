import {
  getAccountRecoveryStore,
  recordAccountRecoveryEvent,
  recoveryTokenSchema,
} from "@/lib/auth/recovery-store"
import { auditContextFromRequest } from "@/lib/auth/audit"
import { fail, isSameOriginRequest, ok } from "@/lib/auth/http"
import { createRateLimiter, clientIp } from "@/lib/site-forms"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const limiter = createRateLimiter({ limit: 20, windowMs: 10 * 60 * 1000 })

/**
 * POST /api/auth/recovery/verify — consumes the emailed one-time token and
 * returns a short-lived recovery session token that authorises the
 * verified-phase endpoints (password, email-verified, status, complete).
 *
 * The emailed token is single-use: a successful exchange burns it and issues
 * the session token instead. Failures report `reason` so the UI can render
 * expired/used/invalid link states.
 */
export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return fail(403, "forbidden", "Cross-origin request blocked.")
  if (!limiter.check(clientIp(request))) {
    return fail(429, "rate_limited", "Too many attempts. Try again later.")
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return fail(400, "invalid_request", "Invalid request body.")
  }
  const parsed = recoveryTokenSchema.safeParse(body)
  if (!parsed.success) return fail(400, "invalid_request", "Invalid recovery link.")

  const consumed = getAccountRecoveryStore().consumeToken(parsed.data.token)
  if (!consumed.ok) {
    recordAccountRecoveryEvent("failed", {
      ...auditContextFromRequest(request),
      metadata: { step: "token_verify", reason: consumed.reason },
    })
    return fail(401, "invalid_token", "This recovery link is invalid or has expired.", {
      reason: consumed.reason,
    })
  }

  recordAccountRecoveryEvent("token_verified", {
    userId: consumed.record.userId,
    email: consumed.record.email,
    ...auditContextFromRequest(request),
  })

  return ok({
    sessionToken: consumed.sessionToken,
    sessionExpiresAt: consumed.sessionExpiresAt,
    email: consumed.record.email,
  })
}
