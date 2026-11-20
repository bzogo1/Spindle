import { getAuthBackend, type TokenPair } from "@/lib/auth/backend"
import { auditContextFromRequest, recordAuthEvent } from "@/lib/auth/audit"
import { consumeBackupCode, getBackupCodeStatus } from "@/lib/auth/backup-codes"
import { mustResetPassword } from "@/lib/auth/forced-reset"
import { applyAuthCookies, fail, isSameOriginRequest, ok } from "@/lib/auth/http"
import { evaluateSuccessfulSignIn } from "@/lib/auth/login-alerts"
import { totpVerifyLoginSchema } from "@/lib/auth/schemas"
import { createRateLimiter, clientIp } from "@/lib/site-forms"
import { verifyAuthToken } from "@/lib/auth/token-codec"
import { logger } from "@/lib/logger"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const limiter = createRateLimiter({ limit: 10, windowMs: 60 * 1000 })

/**
 * POST /api/auth/2fa/verify-login — second step of password sign-in when the
 * account has TOTP enabled. Accepts a 6-digit code or a backup code; the
 * challenge token is single-purpose and expires after 5 minutes.
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
  const parsed = totpVerifyLoginSchema.safeParse(body)
  if (!parsed.success) {
    return fail(400, "invalid_request", "Enter the 6-digit code or a backup code.")
  }

  const backend = getAuthBackend()
  const code = parsed.data.code.trim()
  // Backup codes normalized are 8 chars; a 6-digit input can only be TOTP.
  const totpShaped = /^\d{6}$/.test(code)

  // Backup codes live in two places: the set issued at enrollment (hashed
  // inside the backend) and sets regenerated via /api/auth/2fa/backup-codes
  // (the backup-code store). Once a managed set exists it supersedes the
  // enrollment set — regenerating invalidates every older code, so a
  // managed user gets NO backend fallback for backup-shaped input.
  const challengePayload = verifyAuthToken(parsed.data.challenge, "totp-challenge")
  // A challenge issued BEFORE the forced-reset flag was set stays valid for
  // up to 5 minutes — re-check the flag here so a stale challenge cannot
  // mint a session. This sits ahead of BOTH session paths below
  // (verifyTotpLogin for TOTP/enrollment backup codes and
  // createSessionForUser for managed backup codes) and before any code is
  // consumed, so a refused attempt does not burn a backup code.
  if (challengePayload && mustResetPassword(challengePayload.uid)) {
    recordAuthEvent({
      type: "signin.failure",
      userId: challengePayload.uid,
      ...auditContextFromRequest(request),
      metadata: { reason: "password_reset_required", via: "2fa_verify" },
    })
    return fail(
      403,
      "password_reset_required",
      "Your password must be reset before you can sign in. Use the password reset link sent to your email, or request a new one.",
    )
  }
  const managedUid =
    !totpShaped && challengePayload && getBackupCodeStatus(challengePayload.uid).managed
      ? challengePayload.uid
      : null

  let tokens: TokenPair | null = null
  let via: "totp" | "backup_code" | null = null
  if (managedUid) {
    // Re-validate before consuming: the challenge may predate a 2FA disable,
    // and the user lookup must happen first so a missing/disabled account
    // never burns a code.
    const user = await backend.getUserById(managedUid)
    if (
      user &&
      (await backend.isTotpEnabled(user.id)) &&
      (await consumeBackupCode(managedUid, code))
    ) {
      tokens = await backend.createSessionForUser(user.id)
      via = "backup_code"
    }
  } else {
    tokens = await backend.verifyTotpLogin(parsed.data.challenge, code)
    if (tokens) via = totpShaped ? "totp" : "backup_code"
  }

  if (!tokens) {
    return fail(401, "totp_invalid", "Invalid code. Check your authenticator and try again.")
  }

  // Suspicious-login heuristics run only once a session actually exists —
  // a failed or pending TOTP attempt is not a sign-in.
  evaluateSuccessfulSignIn({
    userId: tokens.session.user.id,
    email: tokens.session.user.email,
    ip: clientIp(request),
    userAgent: request.headers.get("user-agent"),
  })
  logger.info({ event: "auth.signin.2fa", userId: tokens.session.user.id, via }, "2FA sign-in.")
  return applyAuthCookies(ok({ session: tokens.session }), tokens, {
    remember: parsed.data.remember,
  })
}
