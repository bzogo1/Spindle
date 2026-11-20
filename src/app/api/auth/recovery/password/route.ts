import { getAuthBackend } from "@/lib/auth/backend"
import {
  getAccountRecoveryStore,
  recordAccountRecoveryEvent,
  recoveryPasswordSchema,
} from "@/lib/auth/recovery-store"
import { fail, isSameOriginRequest, ok } from "@/lib/auth/http"
import { auditContextFromRequest } from "@/lib/auth/audit"
import { createRateLimiter, clientIp } from "@/lib/site-forms"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const limiter = createRateLimiter({ limit: 10, windowMs: 10 * 60 * 1000 })

/**
 * POST /api/auth/recovery/password — sets a new password during the verified
 * recovery phase. Requires the recovery session token; the password itself
 * is never logged or audited.
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
  const parsed = recoveryPasswordSchema.safeParse(body)
  if (!parsed.success) {
    return fail(400, "invalid_request", "Password must be at least 8 characters.")
  }

  const store = getAccountRecoveryStore()
  const record = store.getBySessionToken(parsed.data.sessionToken)
  if (!record) {
    return fail(401, "invalid_token", "This recovery session has expired. Start again.")
  }

  const backend = getAuthBackend()
  await backend.setPassword(record.userId, parsed.data.password)
  store.markPasswordReset(record.userId)

  recordAccountRecoveryEvent("password_reset", {
    userId: record.userId,
    email: record.email,
    ...auditContextFromRequest(request),
  })

  return ok({ reset: true })
}
