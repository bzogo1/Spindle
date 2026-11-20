import { getAuthBackend } from "@/lib/auth/backend"
import { auditContextFromRequest, recordAuthEvent } from "@/lib/auth/audit"
import {
  accessTokenFromRequest,
  clearAuthCookies,
  fail,
  isSameOriginRequest,
  ok,
  refreshTokenFromRequest,
} from "@/lib/auth/http"
import { logger } from "@/lib/logger"
import { authRateLimited, clientIp, createAuthRateLimiter } from "@/lib/auth-endpoint-rate-limit"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// Same tier as other single-use-token endpoints: tight enough to blunt
// scripted abuse, generous for a once-in-a-while security action.
const limiter = createAuthRateLimiter("tokenConsume")

/**
 * POST /api/auth/sessions/revoke-all — "sign out everywhere".
 *
 * Revokes EVERY live session for the caller (all devices, including this
 * one) via `AuthBackend.revokeAllSessions`, records a `session.revoked`
 * audit event, and clears both auth cookies so this browser is signed out
 * immediately. Idempotent: a repeat call with a still-valid access token
 * returns ok again.
 *
 * Identity resolution: the `spindle_at` access cookie is preferred. When it
 * is missing or expired but a `spindle_rt` refresh cookie is present, the
 * refresh token is rotated once to recover the user id — harmless here
 * because every session (including the freshly issued one) is revoked and
 * the cookies are cleared in the same response.
 */
export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return fail(403, "forbidden", "Cross-origin request blocked.")
  }
  if (!limiter.check(clientIp(request))) {
    return authRateLimited()
  }

  const backend = getAuthBackend()

  let userId: string | null = null

  const access = accessTokenFromRequest(request)
  if (access) {
    userId = access.uid
  } else {
    const refreshToken = refreshTokenFromRequest(request)
    if (refreshToken) {
      try {
        const tokens = await backend.refreshSession(refreshToken)
        userId = tokens?.session.user.id ?? null
      } catch {
        // Fall through to the 401 below.
      }
    }
  }

  if (!userId) {
    return fail(401, "unauthenticated", "Sign in required.")
  }

  const user = await backend.getUserById(userId)
  if (!user) {
    // The account is gone — drop the stale cookies so the browser does not
    // keep retrying a session that can never resolve.
    return clearAuthCookies(fail(401, "unauthenticated", "Sign in required."))
  }

  await backend.revokeAllSessions(user.id)

  recordAuthEvent({
    type: "session.revoked",
    userId: user.id,
    email: user.email,
    ...auditContextFromRequest(request),
    metadata: { scope: "all" },
  })
  logger.info({ event: "auth.sessions.revoke_all", userId: user.id }, "All sessions revoked.")

  // Clear cookies unconditionally: this device's session is revoked too, so
  // leaving them set would only produce 401s on the next request.
  return clearAuthCookies(ok({ revoked: true }))
}
