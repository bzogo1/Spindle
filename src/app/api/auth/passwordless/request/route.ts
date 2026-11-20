import { getAuthBackend, TOKEN_TTL } from "@/lib/auth/backend"
import {
  formatMagicLinkExpiry,
  getMagicLinkConfig,
  sanitizeMagicLinkNextPath,
} from "@/lib/auth/magic-link-config"
import { authLink, sendAuthEmail } from "@/lib/auth/mailer"
import { fail, isSameOriginRequest, ok } from "@/lib/auth/http"
import { passwordlessRequestSchema } from "@/lib/auth/schemas"
import {
  AUTH_LIMITS,
  authRateLimited,
  clientIp,
  createAuthRateLimiter,
} from "@/lib/auth-endpoint-rate-limit"
import { logger } from "@/lib/logger"
import { renderAuthLinkEmail } from "@/emails/templates"

import { passwordlessRequestCooldown } from "@/app/api/auth/passwordless/cooldown"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const limiter = createAuthRateLimiter(AUTH_LIMITS.emailSend)

function rateLimited(retryAfter: number): Response {
  const response = fail(
    429,
    "rate_limited",
    "A link was already sent recently. Check your inbox or try again later.",
    { retryAfter },
  )
  response.headers.set("Retry-After", String(retryAfter))
  return response
}

/**
 * POST /api/auth/passwordless/request — emails a single-use sign-in or
 * verification link. Always returns ok so the endpoint cannot be used to
 * enumerate registered addresses.
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
  const parsed = passwordlessRequestSchema.safeParse(body)
  if (!parsed.success) return fail(400, "invalid_request", "Enter a valid email address.")

  const { email, purpose, next } = parsed.data

  // Per-email cooldown, applied uniformly to known and unknown addresses so
  // the 429 cannot be used to enumerate accounts. `retryAfter` lets the
  // client sync its resend countdown to the server's window.
  const retryAfter = passwordlessRequestCooldown.remainingSeconds(email)
  if (retryAfter > 0) return rateLimited(retryAfter)

  // Arm the cooldown for every well-formed request — including unknown
  // addresses and failed sends — so repeat traffic is throttled the same
  // way regardless of account existence. `markSent` runs before the first
  // backend await, which doubles as in-flight dedupe: a concurrent request
  // for the same email observes the cooldown and gets 429 instead of
  // double-sending.
  passwordlessRequestCooldown.markSent(email)

  const safeNext = sanitizeMagicLinkNextPath(next)
  const backend = getAuthBackend()
  const magicLink = getMagicLinkConfig()
  const user = await backend.getUserByEmail(email)

  if (user) {
    try {
      if (purpose === "verify-email") {
        if (!user.emailVerified) {
          const token = await backend.issueOneTimeToken({
            kind: "verify",
            email: user.email,
            userId: user.id,
            ttlMs: TOKEN_TTL.verifyMs,
          })
          const linkPath = `/verify-email?token=${encodeURIComponent(token)}`
          const email = renderAuthLinkEmail({
            purpose: "verify-email",
            url: authLink(linkPath),
            expiresIn: "24 hours",
          })
          await sendAuthEmail({
            to: user.email,
            ...email,
            linkPath,
          })
        }
      } else {
        const token = await backend.issueOneTimeToken({
          kind: "magic",
          email: user.email,
          userId: user.id,
          ttlMs: magicLink.ttlMs,
        })
        const linkPath = `/magic-link?token=${encodeURIComponent(token)}${
          safeNext ? `&next=${encodeURIComponent(safeNext)}` : ""
        }`
        const email = renderAuthLinkEmail({
          purpose: "magic-link",
          url: authLink(linkPath),
          expiresIn: formatMagicLinkExpiry(magicLink.expiresInMinutes),
        })
        await sendAuthEmail({
          to: user.email,
          ...email,
          linkPath,
        })
      }
    } catch (error) {
      logger.warn({ event: "auth.passwordless.send-failed" }, "Passwordless email failed.")
      void error
    }
  }

  return ok({ sent: true })
}
