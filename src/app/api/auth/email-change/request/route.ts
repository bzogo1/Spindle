import { fail, isSameOriginRequest, ok } from "@/lib/auth/http"
import { authLink, sendAuthEmail } from "@/lib/auth/mailer"
import { emailField } from "@/lib/auth/schemas"
import { createRateLimiter, clientIp } from "@/lib/site-forms"
import { logger } from "@/lib/logger"
import { escapeHtml } from "@/emails/layout"
import {
  EMAIL_CHANGE_CONFIRM_PATH,
  emailChangeResendCooldown,
  requestEmailChange,
  resolveEmailChangeIdentity,
} from "@/lib/email-change"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const limiter = createRateLimiter({ limit: 5, windowMs: 10 * 60 * 1000 })

function rateLimited(retryAfter: number): Response {
  const response = fail(
    429,
    "rate_limited",
    "Please wait a moment before requesting another verification email.",
    { retryAfter },
  )
  response.headers.set("Retry-After", String(retryAfter))
  return response
}

/**
 * POST /api/auth/email-change/request — starts (or restarts) an email change.
 * A signed single-use link is emailed to the NEW address; the old address is
 * notified only after the change is confirmed.
 *
 * The per-principal cooldown mirrors `verify-email/resend`: it is checked
 * and marked before the email send so request rate — not delivery — is
 * limited, and concurrent requests dedupe through the same window.
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
    return fail(401, "unauthenticated", "Sign in to change your email.")
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return fail(400, "invalid_request", "Request body must be JSON.")
  }
  const parsed = emailField.safeParse(
    typeof body === "object" && body !== null
      ? (body as { newEmail?: unknown }).newEmail
      : undefined,
  )
  if (!parsed.success) {
    return fail(400, "invalid_request", "Enter a valid email address.")
  }

  const retryAfter = emailChangeResendCooldown.remainingSeconds(identity.principal)
  if (retryAfter > 0) return rateLimited(retryAfter)

  const result = requestEmailChange(identity, parsed.data)
  if (!result.ok) {
    return fail(422, "invalid_email", result.error)
  }
  emailChangeResendCooldown.markSent(identity.principal)

  const linkPath = `${EMAIL_CHANGE_CONFIRM_PATH}?token=${encodeURIComponent(result.token)}`
  const expiresIn = "24 hours"
  // Fire-and-forget like verify-email/resend: delivery latency/failures must
  // not change the response. TODO(email-templates): move this copy into a
  // dedicated renderEmailChangeEmail once src/emails grows the purpose.
  void sendAuthEmail({
    to: result.pending.newEmail,
    subject: "Confirm your new Spindle email address",
    text: [
      `You asked to change the email address on your Spindle account to ${result.pending.newEmail}.`,
      "",
      `Confirm the change within ${expiresIn}:`,
      authLink(linkPath),
      "",
      "This link expires in 24 hours and can be used once. If you did not request this change, ignore this email — your account email stays the same.",
    ].join("\n"),
    html: `<p>You asked to change the email address on your Spindle account to <strong>${escapeHtml(result.pending.newEmail)}</strong>.</p><p><a href="${escapeHtml(authLink(linkPath))}">Confirm your new email address</a></p><p>This link expires in ${expiresIn} and can be used once. If you did not request this change, ignore this email — your account email stays the same.</p>`,
    linkPath,
  }).catch((error: unknown) => {
    logger.warn(
      { event: "auth.email-change.send-failed" },
      "Email-change verification send failed.",
    )
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
