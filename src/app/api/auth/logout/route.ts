import { getAuthBackend } from "@/lib/auth/backend"
import { auditContextFromRequest, recordAuthEvent } from "@/lib/auth/audit"
import {
  accessTokenFromRequest,
  clearAuthCookies,
  isSameOriginRequest,
  ok,
  refreshTokenFromRequest,
} from "@/lib/auth/http"
import { logger } from "@/lib/logger"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * POST /api/auth/logout — revokes the refresh-token session server-side and
 * clears both auth cookies. Idempotent: always returns ok.
 */
export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    // Still clear cookies so a cross-site POST cannot leave a stale session.
    return clearAuthCookies(ok())
  }

  const refreshToken = refreshTokenFromRequest(request)
  if (refreshToken) {
    try {
      await getAuthBackend().revokeSession(refreshToken)
    } catch {
      // Revocation is best effort; cookies are cleared regardless.
    }
  }
  // Attribute the event when a valid access token is present; anonymous
  // sign-outs are still recorded with null user fields.
  const access = accessTokenFromRequest(request)
  recordAuthEvent({
    type: "logout",
    userId: access?.uid ?? null,
    email: access?.email ?? null,
    ...auditContextFromRequest(request),
    metadata: { hadRefreshToken: refreshToken !== null },
  })
  logger.info({ event: "auth.logout" }, "User signed out.")
  return clearAuthCookies(ok())
}
