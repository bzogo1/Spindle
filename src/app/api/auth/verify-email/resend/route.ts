import { z } from "zod"

import { getAuthBackend, TOKEN_TTL } from "@/lib/auth/backend"
import { authLink, sendAuthEmail } from "@/lib/auth/mailer"
import { fail, isSameOriginRequest, ok } from "@/lib/auth/http"
import { verifyEmailResendCooldown } from "@/lib/auth/resend-cooldown"
import { emailField } from "@/lib/auth/schemas"
import {
  AUTH_LIMITS,
  authRateLimited,
  clientIp,
  createAuthRateLimiter,
} from "@/lib/auth-endpoint-rate-limit"
import { logger } from "@/lib/logger"
import { renderAuthLinkEmail } from "@/emails/templates"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const limiter = createAuthRateLimiter(AUTH_LIMITS.emailSend)

const resendSchema = z.object({ email: emailField })

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
 * POST /api/auth/verify-email/resend — emails a fresh single-use verification
 * link.
 *
 * Cooldown semantics (per syntactically valid email, applied uniformly):
 *  - The per-email cooldown is checked and marked for EVERY well-formed
 *    address — before any account lookup — so the response cannot reveal
 *    whether the address is registered or verified (no enumeration oracle).
 *  - `markSent` runs synchronously before the first `await`, which doubles
 *    as in-flight dedupe: a concurrent request for the same email observes
 *    the cooldown and gets 429 instead of double-sending.
 *  - The cooldown therefore limits request *rate*, not deliveries: a failed
 *    send still consumes the window, which is the desired anti-retry-storm
 *    behaviour.
 *  - Unknown or already-verified addresses still get `ok({ sent: true })`;
 *    the success body carries `retryAfter` so clients can sync their
 *    countdown to the server window.
 *  - The email send itself is fire-and-forget: awaiting the provider HTTP
 *    call only for registered-unverified addresses would make response
 *    latency a side-channel for account existence. Token issuance stays
 *    awaited (cheap, local), but delivery is floated with `.catch` logging
 *    so the response neither waits on nor depends on the send outcome.
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
  const parsed = resendSchema.safeParse(body)
  if (!parsed.success) return fail(400, "invalid_request", "Enter a valid email address.")

  const { email } = parsed.data

  // Uniform cooldown gate: identical for registered, unregistered, and
  // already-verified addresses.
  const retryAfter = verifyEmailResendCooldown.remainingSeconds(email)
  if (retryAfter > 0) return rateLimited(retryAfter)
  verifyEmailResendCooldown.markSent(email)

  const backend = getAuthBackend()
  const user = await backend.getUserByEmail(email)

  if (user && !user.emailVerified) {
    try {
      const token = await backend.issueOneTimeToken({
        kind: "verify",
        email: user.email,
        userId: user.id,
        ttlMs: TOKEN_TTL.verifyMs,
      })
      const linkPath = `/verify-email?token=${encodeURIComponent(token)}`
      const message = renderAuthLinkEmail({
        purpose: "verify-email",
        url: authLink(linkPath),
        expiresIn: "24 hours",
      })
      // Fire-and-forget: do NOT await the provider call — response latency
      // must not reveal whether the address maps to a real unverified
      // account. Failures are logged, never surfaced to the client.
      void sendAuthEmail({
        to: user.email,
        ...message,
        linkPath,
      }).catch((error: unknown) => {
        logger.warn({ event: "auth.verify-email.resend-failed" }, "Verification resend failed.")
        void error
      })
    } catch (error) {
      logger.warn({ event: "auth.verify-email.resend-failed" }, "Verification resend failed.")
      void error
    }
  }

  return ok({
    sent: true,
    retryAfter: verifyEmailResendCooldown.remainingSeconds(email),
  })
}
