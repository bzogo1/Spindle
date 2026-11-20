import { getAuthBackend } from "@/lib/auth/backend"
import { authLink, sendAuthEmail } from "@/lib/auth/mailer"
import { accessTokenFromRequest, fail, isSameOriginRequest, ok } from "@/lib/auth/http"
import {
  getTotpRecoveryStore,
  hashRecoveryToken,
  recordRecoveryAuditEvent,
  RECOVERY_RESEND_MS,
  RECOVERY_TOKEN_TTL_MS,
} from "@/lib/auth/totp-recovery"
import { auditContextFromRequest } from "@/lib/auth/audit"
import { createRateLimiter, clientIp } from "@/lib/site-forms"
import { logger } from "@/lib/logger"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const limiter = createRateLimiter({ limit: 5, windowMs: 10 * 60 * 1000 })

/**
 * POST /api/auth/2fa/recovery/request — starts (or resends) a two-factor
 * recovery for the signed-in user. Emails a single-use token link; the
 * account's 2FA stays enabled until the token is confirmed AND the
 * {@link RECOVERY_COOLDOWN_MS} delay elapses, so an unauthorized request is
 * visible and cancellable long before it takes effect.
 *
 * Requires an authenticated session: the requester must already be signed in
 * (e.g. a remembered session on another device). Truly locked-out users with
 * no session are out of scope for this endpoint — see the recovery docs.
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

  if (!(await backend.isTotpEnabled(user.id))) {
    return fail(403, "totp_not_enabled", "Two-factor authentication is not enabled.")
  }

  const store = getTotpRecoveryStore()
  const created = store.create({ userId: user.id, email: user.email })
  if (!created.ok) {
    // A cooldown is already counting down — report it, don't duplicate.
    return ok({ state: "cooldown", executeAt: created.record.executeAt })
  }

  const { record, resent } = created
  // The throttle only applies after a SUCCESSFUL send — `lastEmailSentAt`
  // stays null until then, so a failed send never locks the user out of
  // retrying (and never masquerades as a sent email).
  if (resent && record.lastEmailSentAt) {
    const sinceLastSend = Date.now() - Date.parse(record.lastEmailSentAt)
    if (sinceLastSend < RECOVERY_RESEND_MS) {
      return ok({
        state: "awaiting_token",
        emailSent: false,
        retryAfterSeconds: Math.ceil((RECOVERY_RESEND_MS - sinceLastSend) / 1000),
      })
    }
  }

  try {
    const token = await backend.issueOneTimeToken({
      kind: "verify",
      email: user.email,
      userId: user.id,
      ttlMs: RECOVERY_TOKEN_TTL_MS,
    })
    // Bind this exact token to the recovery BEFORE sending: confirm rejects
    // any other "verify"-kind token (e.g. email-verification links), which is
    // the only purpose isolation available without a backend token-kind
    // change. Rebinding on resend invalidates previously emailed links.
    store.bindToken(user.id, hashRecoveryToken(token))
    const linkPath = `/two-factor-recovery?token=${encodeURIComponent(token)}`
    await sendAuthEmail({
      to: user.email,
      subject: "Two-factor recovery requested — Spindle",
      text: [
        "Someone requested a two-factor authentication recovery for your Spindle account.",
        "",
        `Confirm the request here (link expires in 1 hour, single use):`,
        authLink(linkPath),
        "",
        "After confirming, two-factor authentication stays on for a 72-hour cooldown before it is disabled — you can cancel at any time from your security settings.",
        "If you did not request this, ignore this email and secure your account (change your password and review active sessions).",
      ].join("\n"),
      linkPath,
    })
    store.markEmailSent(user.id)
  } catch (error) {
    // The recovery record stays pending and `lastEmailSentAt` remains unset,
    // so the user can retry immediately — the response marks the failure
    // distinctly (`sendFailed`) instead of looking like a throttled resend.
    logger.warn(
      { event: "auth.2fa.recovery.send-failed", userId: user.id },
      "Recovery email failed.",
    )
    void error
    recordRecoveryAuditEvent("failed", {
      userId: user.id,
      email: user.email,
      ...auditContextFromRequest(request),
      metadata: { step: "email_send" },
    })
    return ok({ state: "awaiting_token", emailSent: false, sendFailed: true })
  }

  recordRecoveryAuditEvent("requested", {
    userId: user.id,
    email: user.email,
    ...auditContextFromRequest(request),
  })
  return ok({ state: "awaiting_token", emailSent: true })
}
