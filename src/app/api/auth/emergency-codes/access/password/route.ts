import { getAuthBackend } from "@/lib/auth/backend"
import {
  emergencyAccessPasswordSchema,
  getEmergencyAccess,
  markEmergencyAccessPasswordReset,
  recordEmergencyCodeEvent,
} from "@/lib/auth/emergency-codes"
import { auditContextFromRequest } from "@/lib/auth/audit"
import { fail, isSameOriginRequest, ok } from "@/lib/auth/http"
import { checkPasswordBreach } from "@/lib/auth/password-breach"
import { createRateLimiter, clientIp } from "@/lib/site-forms"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const limiter = createRateLimiter({ limit: 10, windowMs: 10 * 60 * 1000 })

/**
 * POST /api/auth/emergency-codes/access/password — sets a new password during
 * a restricted emergency-access session. This is the mandatory first step of
 * break-glass recovery: completion is refused until it runs. The password
 * itself is never logged or audited.
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
  const parsed = emergencyAccessPasswordSchema.safeParse(body)
  if (!parsed.success) {
    return fail(400, "invalid_request", "Password must be at least 8 characters.")
  }

  const record = getEmergencyAccess(parsed.data.accessToken)
  if (!record) {
    recordEmergencyCodeEvent("access_failed", {
      ...auditContextFromRequest(request),
      metadata: { step: "password", reason: "invalid_token" },
    })
    return fail(401, "invalid_token", "This recovery session has expired. Start again.")
  }

  // Same local breach check as password reset/confirm and signup: denylist +
  // heuristics, no external calls. Runs before setPassword so a rejected
  // password never reaches the backend; the access session stays live so the
  // caller can retry with a stronger one.
  const breach = checkPasswordBreach(parsed.data.password)
  if (breach.breached) {
    recordEmergencyCodeEvent("access_failed", {
      userId: record.userId,
      email: record.email,
      ...auditContextFromRequest(request),
      metadata: { step: "password", reason: "password_breach", severity: breach.severity },
    })
    return fail(
      400,
      "password_breach",
      "This password is too common or has appeared in known data breaches. Please choose a different one.",
      { severity: breach.severity },
    )
  }

  const backend = getAuthBackend()
  await backend.setPassword(record.userId, parsed.data.password)
  markEmergencyAccessPasswordReset(parsed.data.accessToken)

  recordEmergencyCodeEvent("password_reset", {
    userId: record.userId,
    email: record.email,
    ...auditContextFromRequest(request),
  })

  return ok({ updated: true })
}
