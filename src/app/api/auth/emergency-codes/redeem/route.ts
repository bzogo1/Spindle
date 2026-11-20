import { getAuthBackend } from "@/lib/auth/backend"
import { authLink, sendAuthEmail } from "@/lib/auth/mailer"
import {
  consumeEmergencyCode,
  createEmergencyAccess,
  emergencyRedeemSchema,
  recordEmergencyCodeEvent,
  revokeEmergencyCodes,
} from "@/lib/auth/emergency-codes"
import { auditContextFromRequest } from "@/lib/auth/audit"
import { fail, isSameOriginRequest, ok } from "@/lib/auth/http"
import { createRateLimiter, clientIp } from "@/lib/site-forms"
import { logger } from "@/lib/logger"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const limiter = createRateLimiter({ limit: 10, windowMs: 10 * 60 * 1000 })

/**
 * POST /api/auth/emergency-codes/redeem — break-glass redemption. Unauthenticated
 * by design: the caller proves account control with an emergency code plus the
 * account email.
 *
 * A successful redemption NEVER creates a sign-in session. It returns a
 * short-lived restricted access token that only authorises the
 * `/api/auth/emergency-codes/access/*` endpoints (set a new password, mark the
 * email verified, complete). Before issuing it the route:
 *   - burns every remaining emergency code for the account,
 *   - revokes ALL existing auth sessions,
 *   - emails a security notice to the account address (best-effort).
 *
 * Failures are indistinguishable to the caller (`invalid_code`) so the
 * endpoint cannot be used to probe which emails have codes; the audit log
 * records the precise reason server-side.
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
  const parsed = emergencyRedeemSchema.safeParse(body)
  if (!parsed.success) {
    return fail(400, "invalid_request", "Enter your account email and an emergency code.")
  }

  const backend = getAuthBackend()
  const user = await backend.getUserByEmail(parsed.data.email)

  if (!user) {
    recordEmergencyCodeEvent("redeem_failed", {
      ...auditContextFromRequest(request),
      metadata: { reason: "unknown_email" },
    })
    return fail(401, "invalid_code", "That emergency code is invalid, expired, or already used.")
  }

  const consumed = await consumeEmergencyCode(user.id, parsed.data.code)
  if (!consumed.ok) {
    recordEmergencyCodeEvent("redeem_failed", {
      userId: user.id,
      email: user.email,
      ...auditContextFromRequest(request),
      metadata: { reason: consumed.reason },
    })
    // Anti-enumeration: the precise reason stays in the audit log only. The
    // client gets the same generic invalid_code for every failure mode —
    // including the unknown-email branch above — so responses cannot reveal
    // whether an email is registered or probe a code's state.
    return fail(401, "invalid_code", "That emergency code is invalid, expired, or already used.")
  }

  // Break-glass containment: one redeemed code burns the rest of the set and
  // every existing session dies — only the restricted access session below
  // remains, and it can do nothing but rotate credentials.
  //
  // Ordering note: the code is already consumed at this point, so a throw
  // here cannot be rolled back. We fail CLOSED — return 500 without issuing
  // an access token — because issuing a token that skipped session
  // revocation would leave stolen sessions alive. A burned code is
  // recoverable (the user still has sessions unless revocation succeeded,
  // and can regenerate codes); a live token without containment is not.
  let access: ReturnType<typeof createEmergencyAccess>
  try {
    revokeEmergencyCodes(user.id)
    await backend.revokeAllSessions(user.id)
    access = createEmergencyAccess({ userId: user.id, email: user.email })
  } catch (error) {
    logger.error(
      { event: "auth.emergency-codes.redeem-containment-failed", userId: user.id, err: error },
      "Emergency code redeemed but session revocation/access issuance failed.",
    )
    recordEmergencyCodeEvent("redeem_failed", {
      userId: user.id,
      email: user.email,
      ...auditContextFromRequest(request),
      metadata: { reason: "containment_failed" },
    })
    return fail(
      500,
      "redeem_failed",
      "Emergency access could not be completed. Please try again or contact support.",
    )
  }

  try {
    await sendAuthEmail({
      to: user.email,
      subject: "Emergency access used on your Spindle account — Spindle",
      text: [
        "An emergency access code was just used to recover your Spindle account.",
        "",
        "All of your emergency codes and every existing sign-in session were revoked. You must set a new password to finish securing the account.",
        "If this was not you, change your password immediately and contact support.",
        "",
        authLink("/"),
      ].join("\n"),
      linkPath: "/",
    })
  } catch (error) {
    logger.warn(
      { event: "auth.emergency-codes.notify-failed", userId: user.id },
      "Emergency access notification email failed.",
    )
    void error
  }

  recordEmergencyCodeEvent("redeemed", {
    userId: user.id,
    email: user.email,
    ...auditContextFromRequest(request),
    metadata: { accessExpiresAt: access.accessExpiresAt },
  })

  return ok({
    accessToken: access.accessToken,
    accessExpiresAt: access.accessExpiresAt,
    email: user.email,
    passwordResetRequired: true,
  })
}
