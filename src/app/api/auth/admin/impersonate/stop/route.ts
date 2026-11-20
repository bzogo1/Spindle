import {
  AUTH_LIMITS,
  authRateLimited,
  clientIp,
  createAuthRateLimiter,
} from "@/lib/auth-endpoint-rate-limit"
import { getAuthBackend } from "@/lib/auth/backend"
import { accessTokenFromRequest, fail, ok, readCookie } from "@/lib/auth/http"
import {
  applyAdminRestoreCookies,
  clearImpersonationMarker,
  getImpersonationStore,
  IMPERSONATION_COOKIE,
  mintAdminRestoreToken,
  serializeImpersonationRecord,
} from "@/lib/auth/impersonation"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * POST /api/auth/admin/impersonate/stop — end the caller's impersonation.
 *
 * Deliberately NOT gated by `requireAdmin`: while impersonating, the caller
 * IS the target user (a non-admin). Authorization instead comes from
 * possession of the impersonation itself — the `spindle_imp` marker cookie
 * must name a live record AND the current access token must be bound to it:
 * `uid === record.targetUserId` AND `sid === record.id` (the impersonation
 * token's `sid` IS the record id). The `sid` check matters: the real target
 * user could otherwise forge the marker cookie (record ids leak via status
 * responses/audit views) and replay it to mint an admin token. Anyone else
 * gets 401/404; a caller whose admin session was already restored gets a
 * distinct 409 so the UI can reload instead of showing "sign in required".
 *
 * On success the admin's original session is restored: a fresh access token
 * is minted from the admin claims stored on the record (same `sid`, so it
 * slots back into the admin's untouched session) and the marker cookie is
 * cleared. The admin's refresh cookie was never replaced, so nothing else
 * is needed.
 */

const limiter = createAuthRateLimiter(AUTH_LIMITS.publicRead)

export async function POST(request: Request) {
  if (!limiter.check(clientIp(request))) return authRateLimited()

  const recordId = readCookie(request, IMPERSONATION_COOKIE)
  if (!recordId) {
    return fail(404, "no_impersonation", "No active impersonation session.")
  }

  const store = getImpersonationStore()
  const record = store.getActive(recordId)
  if (!record) {
    // Stale marker (ended or expired): clean it up and report nothing to stop.
    return clearImpersonationMarker(
      fail(404, "no_impersonation", "No active impersonation session."),
    )
  }

  // The caller must actually be the impersonated session — marker cookie
  // alone is not proof. `sid === record.id` binds the access token to THIS
  // impersonation (the minted token's sid is the record id), so a stolen
  // marker cannot be paired with the target's ordinary session token.
  const access = accessTokenFromRequest(request)
  const isImpersonatedSession =
    access !== null && access.uid === record.targetUserId && access.sid === record.id
  if (!isImpersonatedSession) {
    // Restored-session window: the admin's refresh cookie already rotated
    // the access token back to the admin (e.g. the client's scheduled
    // refresh fired). Refresh rotation mints a NEW sid, so this keys on
    // `adminUserId`, not `adminSessionId`. Only the admin's own session can
    // carry that uid — the impersonated target never can. There is nothing
    // to stop: drop the stale marker and tell the client to reload.
    const isRestoredAdminSession = access !== null && access.uid === record.adminUserId
    if (isRestoredAdminSession) {
      store.end(record.id, "invalidated")
      return clearImpersonationMarker(
        fail(
          409,
          "session_restored",
          "Your admin session was already restored. Reload to continue.",
        ),
      )
    }
    return fail(401, "unauthenticated", "Sign in required.")
  }

  // Confirm the target still resolves (paranoia: user deleted mid-session).
  const target = await getAuthBackend().getUserById(record.targetUserId)
  if (!target) {
    store.end(record.id, "invalidated")
    return clearImpersonationMarker(
      fail(409, "target_gone", "The impersonated account no longer exists."),
    )
  }

  store.end(record.id, "stopped")
  const restore = mintAdminRestoreToken(record)

  // Session description for the restored ADMIN session so the client can
  // adopt it immediately (re-arming the refresh timer to the admin token's
  // expiry instead of the impersonation's). `sessionId` may be "" when the
  // admin authenticated via the mock-session cookie — `sid` is opaque to
  // session resolution, so the session still works.
  const adminContext = await getAuthBackend().getSessionContext(record.adminUserId)
  const session = adminContext
    ? {
        user: adminContext.user,
        workspace: adminContext.workspace,
        sessionId: record.adminSessionId,
        expiresAt: restore.expiresAt.toISOString(),
      }
    : null

  // Serialize like the status route: the caller is the impersonated (target)
  // session, so admin identity/audit fields (adminEmail, adminUserId,
  // adminSessionId, adminName) must not leak into the response.
  return applyAdminRestoreCookies(
    ok({ stopped: true, impersonation: serializeImpersonationRecord(record), session }),
    { accessToken: restore.token },
  )
}
