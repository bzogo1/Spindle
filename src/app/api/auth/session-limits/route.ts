import { getAuthBackend } from "@/lib/auth/backend"
import { accessTokenFromRequest, fail, isSameOriginRequest, ok } from "@/lib/auth/http"
import {
  DEFAULT_SESSION_LIMIT,
  MAX_SESSION_LIMIT,
  MIN_SESSION_LIMIT,
  getSessionLimitStore,
  sessionLimitSchema,
} from "@/lib/auth/session-limits"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * Resolves the policy owner for a request — same pattern as
 * `/api/auth/policies`: the access token's `uid` is confirmed against the
 * backend so a stale token cannot read or mutate limits for a deleted user.
 */
async function limitOwner(request: Request) {
  const access = accessTokenFromRequest(request)
  if (!access) return null
  const user = await getAuthBackend().getUserById(access.uid)
  return user ? { userId: user.id } : null
}

async function usagePayload(userId: string) {
  const backend = getAuthBackend()
  const sessions = await backend.listSessions(userId)
  const limit = getSessionLimitStore().getLimit(userId)
  return {
    limit,
    unlimited: limit === 0,
    defaultLimit: DEFAULT_SESSION_LIMIT,
    minLimit: MIN_SESSION_LIMIT,
    maxLimit: MAX_SESSION_LIMIT,
    activeCount: sessions.length,
    sessions,
  }
}

/**
 * GET /api/auth/session-limits — the caller's concurrent-session cap plus
 * current usage: `{ limit, unlimited, defaultLimit, minLimit, maxLimit,
 * activeCount, sessions }`. `limit` 0 means unlimited.
 */
export async function GET(request: Request) {
  const owner = await limitOwner(request)
  if (!owner) return fail(401, "unauthenticated", "Sign in required.")
  return ok(await usagePayload(owner.userId))
}

/**
 * PUT /api/auth/session-limits — sets the caller's concurrent-session cap.
 * Body: `{ limit }` where limit is an integer 0–50 (0 = unlimited, default
 * when never set is 5). Enforcement happens inside the backend's session
 * mint funnel (`issueTokens`), so every sign-in path respects the new cap
 * immediately; lowering the limit below the current count evicts the oldest
 * sessions on the next session creation/refresh.
 */
export async function PUT(request: Request) {
  if (!isSameOriginRequest(request)) {
    return fail(403, "forbidden", "Cross-origin request blocked.")
  }
  const owner = await limitOwner(request)
  if (!owner) return fail(401, "unauthenticated", "Sign in required.")

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return fail(400, "invalid_request", "Invalid request body.")
  }
  const parsed = sessionLimitSchema.safeParse(body)
  if (!parsed.success) {
    return fail(
      400,
      "invalid_request",
      `Limit must be a whole number between 0 (unlimited) and ${MAX_SESSION_LIMIT}.`,
    )
  }

  getSessionLimitStore().setLimit(owner.userId, parsed.data.limit)
  return ok(await usagePayload(owner.userId))
}
