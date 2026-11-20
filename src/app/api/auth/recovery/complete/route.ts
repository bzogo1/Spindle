import { getAuthBackend } from "@/lib/auth/backend"
import { authLink, sendAuthEmail } from "@/lib/auth/mailer"
import {
  getAccountRecoveryStore,
  recordAccountRecoveryEvent,
  recoverySessionSchema,
} from "@/lib/auth/recovery-store"
import { fail, isSameOriginRequest, ok } from "@/lib/auth/http"
import { auditContextFromRequest } from "@/lib/auth/audit"
import { createRateLimiter, clientIp } from "@/lib/site-forms"
import { logger } from "@/lib/logger"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const limiter = createRateLimiter({ limit: 10, windowMs: 10 * 60 * 1000 })

/**
 * POST /api/auth/recovery/complete — finishes the guided recovery: revokes
 * every auth session for the account (a stolen session cannot survive) and
 * burns both the emailed token hash and the recovery session token so
 * neither can be replayed. A confirmation email is sent best-effort.
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
  const parsed = recoverySessionSchema.safeParse(body)
  if (!parsed.success) return fail(400, "invalid_request", "Invalid recovery session.")

  const store = getAccountRecoveryStore()
  const record = store.getBySessionToken(parsed.data.sessionToken)
  if (!record) {
    return fail(401, "invalid_token", "This recovery session has expired. Start again.")
  }

  const backend = getAuthBackend()
  await backend.revokeAllSessions(record.userId)
  store.complete(record.userId)

  recordAccountRecoveryEvent("completed", {
    userId: record.userId,
    email: record.email,
    ...auditContextFromRequest(request),
    metadata: { actions: record.actions },
  })

  try {
    await sendAuthEmail({
      to: record.email,
      subject: "Your Spindle account was recovered — Spindle",
      text: [
        "Account recovery for your Spindle account is complete.",
        "",
        "Every existing sign-in session was signed out. Sign in again with your new credentials.",
        "If you did not go through this recovery yourself, change your password immediately and contact support.",
        "",
        authLink("/"),
      ].join("\n"),
      linkPath: "/",
    })
  } catch (error) {
    logger.warn(
      { event: "auth.recovery.notify-failed", userId: record.userId },
      "Recovery completion email failed.",
    )
    void error
  }

  return ok({ completed: true })
}
