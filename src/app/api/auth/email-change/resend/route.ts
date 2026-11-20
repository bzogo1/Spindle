import { fail, isSameOriginRequest, ok } from "@/lib/auth/http"
import { authLink, sendAuthEmail } from "@/lib/auth/mailer"
import { createRateLimiter, clientIp } from "@/lib/site-forms"
import { logger } from "@/lib/logger"
import {
  EMAIL_CHANGE_CONFIRM_PATH,
  emailChangeResendCooldown,
  getPendingEmailChange,
  requestEmailChange,
  resolveEmailChangeIdentity,
} from "@/lib/email-change"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const limiter = createRateLimiter({ limit: 5, windowMs: 10 * 60 * 1000 })

/**
 * POST /api/auth/email-change/resend — emails a fresh confirmation link for
 * the pending change. Resending rotates the pending record id, so links
 * from earlier sends stop working (single active link per change).
 *
 * Shares the per-principal cooldown with `request` so the two endpoints
 * cannot be alternated to bypass the window.
 */
export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return fail(403, "forbidden", "Cross-origin request blocked.")
  }
  if (!limiter.check(clientIp(request))) {
    return fail(429, "rate_limited", "Too many attempts. Try again later.")
  }

  const identity = await resolveEmailChangeIdentity(request)
  if (!identity) {
    return fail(401, "unauthenticated", "Sign in to manage your email change.")
  }

  const pending = getPendingEmailChange(identity.principal)
  if (!pending) {
    return fail(404, "no_pending", "There is no pending email change to resend.")
  }

  const retryAfter = emailChangeResendCooldown.remainingSeconds(identity.principal)
  if (retryAfter > 0) {
    const response = fail(
      429,
      "rate_limited",
      "Please wait a moment before requesting another verification email.",
      { retryAfter },
    )
    response.headers.set("Retry-After", String(retryAfter))
    return response
  }

  // Reuse requestEmailChange: it re-validates, replaces the pending record
  // (rotating the id), and mints a fresh token for the same target address.
  const result = requestEmailChange(identity, pending.newEmail)
  if (!result.ok) {
    return fail(422, "invalid_email", result.error)
  }
  emailChangeResendCooldown.markSent(identity.principal)

  const linkPath = `${EMAIL_CHANGE_CONFIRM_PATH}?token=${encodeURIComponent(result.token)}`
  void sendAuthEmail({
    to: result.pending.newEmail,
    subject: "Confirm your new Spindle email address",
    text: [
      `You asked to change the email address on your Spindle account to ${result.pending.newEmail}.`,
      "",
      `Confirm the change within 24 hours:`,
      authLink(linkPath),
      "",
      "This link expires in 24 hours and can be used once. If you did not request this change, ignore this email — your account email stays the same.",
    ].join("\n"),
    linkPath,
  }).catch((error: unknown) => {
    logger.warn({ event: "auth.email-change.resend-failed" }, "Email-change resend failed.")
    void error
  })

  return ok({
    pending: {
      newEmail: result.pending.newEmail,
      requestedAt: result.pending.requestedAt,
      expiresAt: result.pending.expiresAt,
    },
    retryAfter: emailChangeResendCooldown.remainingSeconds(identity.principal),
  })
}
