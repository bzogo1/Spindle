import { getAuthBackend } from "@/lib/auth/backend"
import { getAccountRecoveryStore, recoverySessionSchema } from "@/lib/auth/recovery-store"
import { listAuthEvents } from "@/lib/auth/audit"
import { fail, isSameOriginRequest, ok } from "@/lib/auth/http"
import { createRateLimiter, clientIp } from "@/lib/site-forms"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const limiter = createRateLimiter({ limit: 60, windowMs: 10 * 60 * 1000 })

const MAX_EVENTS = 10

/**
 * POST /api/auth/recovery/status — state of a verified recovery session:
 * which guided steps are done plus the account's recent auth audit events so
 * the user can review security activity before finishing.
 *
 * Requires the recovery session token issued by `/verify`; it is a bearer
 * secret sent in the body (never a cookie or URL param).
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

  const record = getAccountRecoveryStore().getBySessionToken(parsed.data.sessionToken)
  if (!record) {
    return fail(401, "invalid_token", "This recovery session has expired. Start again.")
  }

  const user = await getAuthBackend().getUserById(record.userId)
  if (!user) {
    return fail(401, "invalid_token", "This recovery session has expired. Start again.")
  }

  const events = listAuthEvents({ userId: user.id, limit: MAX_EVENTS }).map((event) => ({
    timestamp: event.timestamp,
    type: event.type,
    metadata: event.metadata,
  }))

  return ok({
    phase: record.phase,
    email: record.email,
    sessionExpiresAt:
      record.sessionExpiresAt === null ? null : new Date(record.sessionExpiresAt).toISOString(),
    actions: record.actions,
    events,
  })
}
