import { getAuthBackend } from "@/lib/auth/backend"
import {
  applyAuthCookies,
  clearAuthCookies,
  fail,
  isSameOriginRequest,
  ok,
  refreshTokenFromRequest,
} from "@/lib/auth/http"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * POST /api/auth/refresh — rotates the refresh token and issues a new access
 * token. The client calls this single-flight; the backend treats each refresh
 * token as single-use, so a lost rotation race surfaces as 401 and the client
 * signs out cleanly.
 */
export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return fail(403, "forbidden", "Cross-origin request blocked.")

  const refreshToken = refreshTokenFromRequest(request)
  if (!refreshToken) return fail(401, "invalid_token", "No session.")

  const tokens = await getAuthBackend().refreshSession(refreshToken)
  if (!tokens) {
    return clearAuthCookies(fail(401, "invalid_token", "Session expired. Please sign in again."))
  }
  return applyAuthCookies(ok({ session: tokens.session }), tokens, { remember: true })
}
