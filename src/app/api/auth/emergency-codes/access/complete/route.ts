import { getAuthBackend } from "@/lib/auth/backend"
import {
  completeEmergencyAccess,
  emergencyAccessTokenSchema,
  getEmergencyAccess,
  recordEmergencyCodeEvent,
} from "@/lib/auth/emergency-codes"
import { auditContextFromRequest } from "@/lib/auth/audit"
import { fail, isSameOriginRequest, ok } from "@/lib/auth/http"
import { createRateLimiter, clientIp } from "@/lib/site-forms"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const limiter = createRateLimiter({ limit: 10, windowMs: 10 * 60 * 1000 })

/**
 * POST /api/auth/emergency-codes/access/complete — finishes break-glass
 * recovery. Requires that a new password was already set through
 * `access/password` during this session (password_reset is mandatory, not
 * optional). Revokes every auth session again as a final sweep and burns the
 * access token so it can never be replayed.
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
  const parsed = emergencyAccessTokenSchema.safeParse(body)
  if (!parsed.success) return fail(400, "invalid_request", "Invalid recovery session.")

  const record = getEmergencyAccess(parsed.data.accessToken)
  if (!record) {
    recordEmergencyCodeEvent("access_failed", {
      ...auditContextFromRequest(request),
      metadata: { step: "complete", reason: "invalid_token" },
    })
    return fail(401, "invalid_token", "This recovery session has expired. Start again.")
  }

  if (!record.passwordResetAt) {
    return fail(403, "password_required", "Set a new password before finishing account recovery.")
  }

  const backend = getAuthBackend()
  await backend.revokeAllSessions(record.userId)
  completeEmergencyAccess(parsed.data.accessToken)

  recordEmergencyCodeEvent("completed", {
    userId: record.userId,
    email: record.email,
    ...auditContextFromRequest(request),
    metadata: {
      emailVerified: record.emailVerifiedAt !== null,
    },
  })

  return ok({ completed: true })
}
