import { getAuthBackend } from "@/lib/auth/backend"
import { fail, isSameOriginRequest, ok } from "@/lib/auth/http"
import { checkPasswordBreach } from "@/lib/auth/password-breach"
import { getForcedResetStore } from "@/lib/auth/forced-reset"
import { passwordResetConfirmSchema } from "@/lib/auth/schemas"
import { isCaptchaTokenValid } from "@/lib/captcha"
import { createRateLimiter, clientIp } from "@/lib/site-forms"
import { logger } from "@/lib/logger"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const limiter = createRateLimiter({ limit: 10, windowMs: 10 * 60 * 1000 })

/**
 * POST /api/auth/password/reset/confirm — consumes a reset token, sets the new
 * password, and revokes all existing sessions so a stolen session cannot
 * survive the recovery.
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
  const parsed = passwordResetConfirmSchema.safeParse(body)
  if (!parsed.success) {
    return fail(400, "invalid_request", "Password must be at least 8 characters.")
  }

  // Proof-of-work captcha token minted by /api/auth/captcha; read from the raw
  // body since the zod schema strips unknown keys.
  const captchaToken =
    typeof (body as Record<string, unknown>).captchaToken === "string"
      ? ((body as Record<string, unknown>).captchaToken as string)
      : null
  if (!isCaptchaTokenValid(captchaToken)) {
    return fail(403, "captcha_failed", "Security check failed. Please try again.")
  }

  // Local breach check (denylist + heuristics, no external APIs). Runs after
  // the captcha and before the token is consumed, so a rejected password
  // neither burns the reset link nor reaches the backend.
  const breach = checkPasswordBreach(parsed.data.password)
  if (breach.breached) {
    return fail(
      400,
      "password_breach",
      "This password is too common or has appeared in known data breaches. Please choose a different one.",
      { severity: breach.severity },
    )
  }

  const backend = getAuthBackend()
  const consumed = await backend.consumeOneTimeToken(parsed.data.token, "reset")
  const record = consumed.ok ? consumed.record : null
  const user = record?.userId ? await backend.getUserById(record.userId) : null
  if (!record || !user) {
    return fail(401, "invalid_token", "This reset link is invalid or has expired.")
  }

  await backend.setPassword(user.id, parsed.data.password)
  await backend.revokeAllSessions(user.id)
  // A completed reset is the ONLY path that lifts the forced-reset flag —
  // admin clears exist for mistakes, but the intended flow is: flag set →
  // sign-in refused → reset via email link → flag cleared here.
  getForcedResetStore().clear(user.id)
  logger.info({ event: "auth.password.reset", userId: user.id }, "Password reset completed.")
  return ok({ reset: true })
}
