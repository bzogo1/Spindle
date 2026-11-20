import { AuthBackendError, getAuthBackend, TOKEN_TTL } from "@/lib/auth/backend"
import { authLink, sendAuthEmail } from "@/lib/auth/mailer"
import { applyAuthCookies, fail, isSameOriginRequest, ok } from "@/lib/auth/http"
import { evaluateSuccessfulSignIn } from "@/lib/auth/login-alerts"
import { checkPasswordBreach } from "@/lib/auth/password-breach"
import { signUpSchema } from "@/lib/auth/schemas"
import { isCaptchaTokenValid } from "@/lib/captcha"
import { createRateLimiter, clientIp } from "@/lib/site-forms"
import { logger } from "@/lib/logger"
import { renderAuthLinkEmail } from "@/emails/templates"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const limiter = createRateLimiter({ limit: 5, windowMs: 60 * 60 * 1000 })

/**
 * POST /api/auth/signup — creates the account + workspace, sends a verification
 * email, and signs the user in immediately (session cookies set). The account
 * is flagged `emailVerified: false` until the link is consumed.
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
  const parsed = signUpSchema.safeParse(body)
  if (!parsed.success) {
    return fail(400, "invalid_request", "Please check the form and try again.")
  }

  // Proof-of-work captcha token minted by /api/auth/captcha after the client
  // solves a challenge. Read from the raw body: the zod schema strips unknown
  // keys, and captchaToken is verified separately from the credential fields.
  const captchaToken =
    typeof (body as Record<string, unknown>).captchaToken === "string"
      ? ((body as Record<string, unknown>).captchaToken as string)
      : null
  if (!isCaptchaTokenValid(captchaToken)) {
    return fail(403, "captcha_failed", "Security check failed. Please try again.")
  }

  const input = parsed.data

  // Local breach check (denylist + heuristics, no external APIs). Runs after
  // the captcha so it cannot be used as a password oracle, and before any
  // backend work so a rejected password creates nothing.
  const breach = checkPasswordBreach(input.password)
  if (breach.breached) {
    return fail(
      400,
      "password_breach",
      "This password is too common or has appeared in known data breaches. Please choose a different one.",
      { severity: breach.severity },
    )
  }

  const backend = getAuthBackend()

  let created: { user: { id: string; email: string } }
  try {
    const result = await backend.signUp({
      email: input.email,
      password: input.password,
      workspaceName: input.workspaceName,
    })
    created = result
  } catch (error) {
    if (error instanceof AuthBackendError && error.code === "email_taken") {
      return fail(409, "email_taken", "An account already uses this email.")
    }
    throw error
  }

  // Verification link — best effort; sign-in still succeeds without it.
  try {
    const token = await backend.issueOneTimeToken({
      kind: "verify",
      email: created.user.email,
      userId: created.user.id,
      ttlMs: TOKEN_TTL.verifyMs,
    })
    const link = authLink(`/verify-email?token=${encodeURIComponent(token)}`)
    const email = renderAuthLinkEmail({
      purpose: "verify-email",
      url: link,
      expiresIn: "24 hours",
    })
    await sendAuthEmail({
      to: created.user.email,
      ...email,
      linkPath: `/verify-email?token=${encodeURIComponent(token)}`,
    })
  } catch (error) {
    logger.warn({ event: "auth.verify-email.send-failed" }, "Verification email failed to send.")
    void error
  }

  // The account was just created with this password and has no 2FA yet, so
  // signIn cannot return totp_required here.
  const signIn = await backend.signIn(input.email, input.password)
  if (signIn.status !== "ok") {
    return fail(500, "unknown", "Account created but sign-in failed. Please sign in.")
  }

  // Seeds the device/IP fingerprints for future sign-ins; being the account's
  // first sign-in it produces no alerts by design.
  evaluateSuccessfulSignIn({
    userId: created.user.id,
    email: created.user.email,
    ip: clientIp(request),
    userAgent: request.headers.get("user-agent"),
  })
  logger.info({ event: "auth.signup", userId: created.user.id }, "Account created.")
  return applyAuthCookies(ok({ status: "ok", session: signIn.tokens.session }), signIn.tokens, {
    remember: input.remember,
  })
}
