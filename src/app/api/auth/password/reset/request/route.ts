import { getAuthBackend, TOKEN_TTL } from "@/lib/auth/backend"
import { authLink, sendAuthEmail } from "@/lib/auth/mailer"
import { fail, isSameOriginRequest, ok } from "@/lib/auth/http"
import { emailField } from "@/lib/auth/schemas"
import { z } from "zod"
import {
  AUTH_LIMITS,
  authRateLimited,
  clientIp,
  createAuthRateLimiter,
  passwordResetRequestCooldown,
} from "@/lib/auth-endpoint-rate-limit"
import { logger } from "@/lib/logger"
import { renderResetPasswordEmail } from "@/emails/templates"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const limiter = createAuthRateLimiter(AUTH_LIMITS.emailSend)
const schema = z.object({ email: emailField })

function rateLimited(retryAfter: number): Response {
  const response = fail(
    429,
    "rate_limited",
    "A reset link was already sent recently. Check your inbox or try again later.",
    { retryAfter },
  )
  response.headers.set("Retry-After", String(retryAfter))
  return response
}

/**
 * POST /api/auth/password/reset/request — emails a single-use reset link.
 * Always returns ok for valid input so registered addresses are not
 * enumerable; unknown addresses simply get no email.
 *
 * Two independent throttles, both required for the anti-enumeration
 * contract:
 *  - per-IP `emailSend` limiter above, and
 *  - a per-email cooldown (same model as `/api/auth/verify-email/resend`)
 *    checked and marked for EVERY well-formed address — before any account
 *    lookup — so the 429 + `retryAfter` reveals nothing about whether the
 *    address is registered. Without it, rotating IPs could mail-bomb a
 *    single victim.
 */
export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return fail(403, "forbidden", "Cross-origin request blocked.")
  if (!limiter.check(clientIp(request))) return authRateLimited()

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return fail(400, "invalid_request", "Invalid request body.")
  }
  const parsed = schema.safeParse(body)
  if (!parsed.success) return fail(400, "invalid_request", "Enter a valid email address.")

  // Uniform cooldown gate: identical for registered and unknown addresses.
  // `markSent` runs before the first `await`, which also dedupes concurrent
  // requests for the same email.
  const { email } = parsed.data
  const retryAfter = passwordResetRequestCooldown.remainingSeconds(email)
  if (retryAfter > 0) return rateLimited(retryAfter)
  passwordResetRequestCooldown.markSent(email)

  const backend = getAuthBackend()
  const user = await backend.getUserByEmail(email)

  if (user) {
    try {
      const token = await backend.issueOneTimeToken({
        kind: "reset",
        email: user.email,
        userId: user.id,
        ttlMs: TOKEN_TTL.resetMs,
      })
      const linkPath = `/reset-password/${encodeURIComponent(token)}`
      const email = renderResetPasswordEmail({ url: authLink(linkPath) })
      await sendAuthEmail({
        to: user.email,
        ...email,
        linkPath,
      })
    } catch (error) {
      logger.warn({ event: "auth.reset.send-failed" }, "Password reset email failed.")
      void error
    }
  }

  return ok({ sent: true })
}
