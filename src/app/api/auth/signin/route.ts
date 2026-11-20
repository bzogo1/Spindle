import { getAuthBackend } from "@/lib/auth/backend"
import { auditContextFromRequest, recordAuthEvent } from "@/lib/auth/audit"
import { applyAuthCookies, fail, isSameOriginRequest, ok } from "@/lib/auth/http"
import { getSignInLockout } from "@/lib/auth/lockout"
import { mustResetPassword } from "@/lib/auth/forced-reset"
import { verifyAuthToken } from "@/lib/auth/token-codec"
import { evaluateFailedSignIn, evaluateSuccessfulSignIn } from "@/lib/auth/login-alerts"
import { signInSchema } from "@/lib/auth/schemas"
import { createRateLimiter, clientIp } from "@/lib/site-forms"
import { logger } from "@/lib/logger"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// Credential guessing is the main threat here; per-instance best effort.
const limiter = createRateLimiter({ limit: 10, windowMs: 60 * 1000 })

/**
 * POST /api/auth/signin — email + password. Returns either a session (auth
 * cookies are set) or `{ status: "totp_required", challenge }` when the
 * account has 2FA enabled; the client then calls `/api/auth/2fa/verify-login`.
 *
 * Forced password reset: when the account's flag is set (see
 * `src/lib/auth/forced-reset.ts`, managed via `/api/auth/forced-reset`) a
 * correct password does NOT produce a session — the route answers
 * `403 { code: "password_reset_required" }` instead. The check runs after
 * credential verification (never before, so it cannot become an
 * account-enumeration oracle) and covers both the direct-session path and
 * the TOTP path (the challenge is withheld, so `/api/auth/2fa/verify-login`
 * cannot be used to bypass the reset). The user recovers through the
 * unauthenticated `/reset-password` email flow; completing
 * `/api/auth/password/reset/confirm` clears the flag.
 */
export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return fail(403, "forbidden", "Cross-origin request blocked.")
  const context = auditContextFromRequest(request)
  if (!limiter.check(clientIp(request))) {
    recordAuthEvent({
      type: "signin.failure",
      ...context,
      metadata: { reason: "rate_limited" },
    })
    return fail(429, "rate_limited", "Too many attempts. Try again later.")
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return fail(400, "invalid_request", "Invalid request body.")
  }
  const parsed = signInSchema.safeParse(body)
  if (!parsed.success) return fail(400, "invalid_request", "Invalid email or password.")

  // Account lockout is checked BEFORE any user lookup: state is keyed on the
  // submitted email string (and source IP) only, so unknown emails lock and
  // unlock identically to real accounts — the 429 below never reveals whether
  // the email exists.
  const lockout = getSignInLockout()
  const lockStatus = lockout.check(parsed.data.email, context.ip)
  if (lockStatus.locked) {
    recordAuthEvent({
      type: "signin.failure",
      email: parsed.data.email,
      ...context,
      metadata: {
        reason: "account_locked",
        retryAfterSeconds: lockStatus.retryAfterSeconds,
      },
    })
    return fail(429, "account_locked", "Too many failed sign-in attempts. Try again later.", {
      retryAfter: lockStatus.retryAfterSeconds,
    })
  }

  const backend = getAuthBackend()
  const result = await backend.signIn(parsed.data.email, parsed.data.password)

  if (result.status === "invalid") {
    // Never log the password or any token material — only the attempted email
    // and a reason code.
    const alert = await evaluateFailedSignIn(backend, {
      email: parsed.data.email,
      ip: context.ip,
      userAgent: context.userAgent,
    })
    const lock = lockout.recordFailure(parsed.data.email, context.ip)
    recordAuthEvent({
      type: "signin.failure",
      email: parsed.data.email,
      ...context,
      metadata: {
        reason: "invalid_credentials",
        ...(alert ? { alertId: alert.id, alertKind: alert.kind } : {}),
        ...(lock.locked
          ? { lockoutTriggered: true, retryAfterSeconds: lock.retryAfterSeconds }
          : {}),
      },
    })
    // The attempt that crosses the threshold already answers with the
    // lockout envelope so the client can start its countdown immediately.
    if (lock.locked) {
      return fail(429, "account_locked", "Too many failed sign-in attempts. Try again later.", {
        retryAfter: lock.retryAfterSeconds,
      })
    }
    return fail(401, "invalid_credentials", "Invalid email or password.")
  }
  if (result.status === "totp_required") {
    // The password was correct — clear the failure counters so a legit user
    // mid-2FA is not locked out by earlier mistyped attempts.
    lockout.recordSuccess(parsed.data.email)
    // Forced reset also blocks the 2FA path: withhold the challenge so
    // verify-login cannot mint a session for a flagged account. The uid is
    // read from the signed challenge payload — no extra user lookup needed.
    const challengeUid = verifyAuthToken(result.challenge, "totp-challenge")?.uid
    if (challengeUid && mustResetPassword(challengeUid)) {
      recordAuthEvent({
        type: "signin.failure",
        userId: challengeUid,
        email: parsed.data.email,
        ...context,
        metadata: { reason: "password_reset_required" },
      })
      return fail(
        403,
        "password_reset_required",
        "Your password must be reset before you can sign in. Use the password reset link sent to your email, or request a new one.",
      )
    }
    recordAuthEvent({
      type: "signin.totp_challenge",
      email: parsed.data.email,
      ...context,
      metadata: { reason: "totp_required" },
    })
    return ok({ status: "totp_required", challenge: result.challenge })
  }

  lockout.recordSuccess(result.tokens.session.user.email)

  // Forced password reset: credentials verified, but the flag forbids
  // issuing a session. The password was still correct, so failure counters
  // are cleared (same as the TOTP path); the minted-but-never-delivered
  // tokens are unreachable — no cookies are set and the refresh token never
  // reaches the client.
  if (mustResetPassword(result.tokens.session.user.id)) {
    // signIn already minted a session row (and may have evicted older
    // sessions via the per-user cap). Revoke the just-created session by
    // its refresh token so repeated flagged attempts cannot pile up orphaned
    // sessions or evict legitimate ones. Best effort: the response is
    // refused either way.
    try {
      await backend.revokeSession(result.tokens.refreshToken)
    } catch (error) {
      logger.warn(
        { err: error, event: "auth.signin.forced_reset_revoke_failed" },
        "Failed to revoke session minted for a forced-reset sign-in.",
      )
    }
    recordAuthEvent({
      type: "signin.failure",
      userId: result.tokens.session.user.id,
      email: result.tokens.session.user.email,
      ...context,
      metadata: { reason: "password_reset_required" },
    })
    return fail(
      403,
      "password_reset_required",
      "Your password must be reset before you can sign in. Use the password reset link sent to your email, or request a new one.",
    )
  }

  const alerts = evaluateSuccessfulSignIn({
    userId: result.tokens.session.user.id,
    email: result.tokens.session.user.email,
    ip: context.ip,
    userAgent: context.userAgent,
  })
  recordAuthEvent({
    type: "signin.success",
    userId: result.tokens.session.user.id,
    email: result.tokens.session.user.email,
    ...context,
    metadata: alerts.length
      ? { alertIds: alerts.map((alert) => alert.id), alertKinds: alerts.map((a) => a.kind) }
      : undefined,
  })
  logger.info({ event: "auth.signin", userId: result.tokens.session.user.id }, "User signed in.")
  return applyAuthCookies(ok({ status: "ok", session: result.tokens.session }), result.tokens, {
    remember: parsed.data.remember,
  })
}
