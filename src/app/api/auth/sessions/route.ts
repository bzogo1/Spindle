import {
  AUTH_LIMITS,
  authRateLimited,
  clientIp,
  createAuthRateLimiter,
} from "@/lib/auth-endpoint-rate-limit"
import { getAuthBackend } from "@/lib/auth/backend"
import { accessTokenFromRequest, fail, ok } from "@/lib/auth/http"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * Rate limit: `publicRead` preset (60 req/min per IP) like other read-only
 * auth endpoints.
 */
const limiter = createAuthRateLimiter(AUTH_LIMITS.publicRead)

/**
 * GET /api/auth/sessions — list the caller's active sessions.
 *
 * Returns `{ sessions, currentSessionId, supported: true }` where
 * `sessions` comes from `AuthBackend.listSessions(user.id)` (newest first;
 * each entry is `{ id, createdAt, expiresAt }`) and `currentSessionId` is
 * the `sid` claim of the access token used for the request — it equals the
 * session `id`, so clients compare the two to mark "this device".
 *
 * `supported` is kept in the payload so clients written against the old
 * `{ sessions: null, supported: false }` probe keep feature-detecting
 * correctly now that listing is real.
 *
 * Per-session revocation is intentionally absent: `AuthBackend.revokeSession`
 * takes the session's refresh token, which is never exposed to clients, so
 * the only revocation surface today is POST /api/auth/sessions/revoke-all.
 * User agents and last-used timestamps are likewise not stored on sessions
 * yet (see prisma/AUTH-SCHEMA.md).
 */
export async function GET(request: Request) {
  if (!limiter.check(clientIp(request))) return authRateLimited()

  const access = accessTokenFromRequest(request)
  if (!access) {
    return fail(401, "unauthenticated", "Sign in required.")
  }
  const backend = getAuthBackend()
  const user = await backend.getUserById(access.uid)
  if (!user) {
    return fail(401, "unauthenticated", "Sign in required.")
  }
  const sessions = await backend.listSessions(user.id)
  return ok({ sessions, currentSessionId: access.sid, supported: true })
}
