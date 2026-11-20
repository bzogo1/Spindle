import { getAuthBackend } from "@/lib/auth/backend"
import {
  accessTokenFromRequest,
  applyAuthCookies,
  ok,
  refreshTokenFromRequest,
} from "@/lib/auth/http"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * GET /api/auth/session — returns the current session description.
 *
 * Resolution order:
 *  1. Valid `spindle_at` access cookie -> user lookup -> session JSON.
 *  2. Otherwise a `spindle_rt` refresh cookie -> rotate the pair, set fresh
 *     cookies, and return the new session.
 *  3. Neither -> `{ session: null }`.
 */
export async function GET(request: Request) {
  const backend = getAuthBackend()

  const access = accessTokenFromRequest(request)
  if (access) {
    const context = await backend.getSessionContext(access.uid)
    if (context) {
      return ok({
        session: {
          user: context.user,
          workspace: context.workspace,
          sessionId: access.sid,
          expiresAt: new Date(access.exp * 1000).toISOString(),
        },
      })
    }
  }

  const refreshToken = refreshTokenFromRequest(request)
  if (refreshToken) {
    const tokens = await backend.refreshSession(refreshToken)
    if (tokens) {
      // The access cookie is always session-scoped; only the refresh cookie
      // mirrors the remember choice. On refresh we cannot know it, so persist
      // the refresh cookie for the refresh TTL — sign-out still clears both.
      return applyAuthCookies(ok({ session: tokens.session }), tokens, { remember: true })
    }
    return ok({ session: null })
  }

  return ok({ session: null })
}
