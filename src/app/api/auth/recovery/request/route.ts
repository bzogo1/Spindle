import { getAuthBackend } from "@/lib/auth/backend"
import { authLink, sendAuthEmail } from "@/lib/auth/mailer"
import { fail, isSameOriginRequest, ok } from "@/lib/auth/http"
import {
  getAccountRecoveryStore,
  recordAccountRecoveryEvent,
  recoveryRequestSchema,
} from "@/lib/auth/recovery-store"
import { auditContextFromRequest } from "@/lib/auth/audit"
import { createRateLimiter, clientIp } from "@/lib/site-forms"
import { logger } from "@/lib/logger"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const limiter = createRateLimiter({ limit: 5, windowMs: 10 * 60 * 1000 })

/**
 * POST /api/auth/recovery/request — starts (or resends) an account-level
 * recovery: emails a single-use token link to `/account-recovery`.
 *
 * Anti-enumeration: the response is identical whether or not the address is
 * registered. Unknown addresses get no email and no recovery record; known
 * addresses get a throttled, single-active recovery per user.
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
  const parsed = recoveryRequestSchema.safeParse(body)
  if (!parsed.success) return fail(400, "invalid_request", "Enter a valid email address.")

  const backend = getAuthBackend()
  const user = await backend.getUserByEmail(parsed.data.email)

  if (user) {
    const store = getAccountRecoveryStore()
    const issued = store.issue({ userId: user.id, email: user.email })

    if (issued.ok) {
      try {
        const linkPath = `/account-recovery?token=${encodeURIComponent(issued.token)}`
        await sendAuthEmail({
          to: user.email,
          subject: "Account recovery link — Spindle",
          text: [
            "Someone requested account recovery for your Spindle account.",
            "",
            `Open this link to verify your inbox and secure your account (single use, expires in 30 minutes):`,
            authLink(linkPath),
            "",
            "The guided recovery lets you set a new password, confirm your email, and review recent security activity — then signs out every other session.",
            "If you did not request this, ignore this email and change your password from a device where you are still signed in.",
          ].join("\n"),
          linkPath,
        })
      } catch (error) {
        logger.warn(
          { event: "auth.recovery.send-failed", userId: user.id },
          "Account recovery email failed.",
        )
        void error
      }
      recordAccountRecoveryEvent("requested", {
        userId: user.id,
        email: user.email,
        ...auditContextFromRequest(request),
      })
    }
    // `resend_throttled`: an identical-looking ok is returned — the client
    // cooldown and the per-user resend window both suppress duplicates.
  }

  return ok({ sent: true })
}
