import { getAuthBackend } from "@/lib/auth/backend"
import {
  emergencyAccessTokenSchema,
  getEmergencyAccess,
  markEmergencyAccessEmailVerified,
  recordEmergencyCodeEvent,
} from "@/lib/auth/emergency-codes"
import { auditContextFromRequest } from "@/lib/auth/audit"
import { fail, isSameOriginRequest, ok } from "@/lib/auth/http"
import { createRateLimiter, clientIp } from "@/lib/site-forms"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const limiter = createRateLimiter({ limit: 10, windowMs: 10 * 60 * 1000 })

/**
 * POST /api/auth/emergency-codes/access/email-verified — marks the account
 * email as verified during a restricted emergency-access session. Optional
 * but recommended: redemption already proved intent via the code, and a
 * verified email restores the account's normal recovery paths.
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
      metadata: { step: "email_verified", reason: "invalid_token" },
    })
    return fail(401, "invalid_token", "This recovery session has expired. Start again.")
  }

  const backend = getAuthBackend()
  await backend.markEmailVerified(record.userId)
  markEmergencyAccessEmailVerified(parsed.data.accessToken)

  recordEmergencyCodeEvent("email_verified", {
    userId: record.userId,
    email: record.email,
    ...auditContextFromRequest(request),
  })

  return ok({ verified: true })
}
