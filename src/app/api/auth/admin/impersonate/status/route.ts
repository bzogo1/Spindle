import { NextResponse } from "next/server"

import { requireAdmin } from "@/lib/admin-guard"
import {
  AUTH_LIMITS,
  authRateLimited,
  clientIp,
  createAuthRateLimiter,
} from "@/lib/auth-endpoint-rate-limit"
import { getAuthBackend } from "@/lib/auth/backend"
import { accessTokenFromRequest, ok, readCookie } from "@/lib/auth/http"
import {
  clearImpersonationMarker,
  getImpersonationStore,
  IMPERSONATION_COOKIE,
  serializeImpersonationRecord,
  serializeImpersonationRecordForAdmin,
} from "@/lib/auth/impersonation"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * GET /api/auth/admin/impersonate/status — current impersonation state for
 * the banner/panel.
 *
 * Two caller shapes:
 *  - Impersonated session (target user, non-admin): identified by the
 *    `spindle_imp` marker + an access token bound to the record (`uid` is
 *    the target AND `sid` is the record id — the impersonation token's sid
 *    IS the record id, so a forged marker cannot be paired with the
 *    target's ordinary session token). Returns `{ active: true,
 *    impersonation }` while live — WITHOUT `adminEmail`, which is admin
 *    audit data and must not leak into the impersonated session. If the
 *    record ended or the access token no longer matches (e.g. the admin's
 *    refresh cookie silently restored the admin session after token expiry),
 *    it returns `{ active: false }` and clears the stale marker.
 *  - Admin session (no marker): `requireAdmin` passes and we report
 *    `{ active: false }` plus the admin's most recent record (if any) as
 *    `lastImpersonation` for the panel's history/audit display.
 *  - Anyone else: 401/403 via `requireAdmin`.
 */

const limiter = createAuthRateLimiter(AUTH_LIMITS.publicRead)

export async function GET(request: Request) {
  if (!limiter.check(clientIp(request))) return authRateLimited()

  const store = getImpersonationStore()
  const marker = readCookie(request, IMPERSONATION_COOKIE)
  const access = accessTokenFromRequest(request)

  if (marker) {
    const record = store.getActive(marker)
    const impersonating =
      record !== null &&
      access !== null &&
      access.uid === record.targetUserId &&
      access.sid === record.id
    if (record && impersonating) {
      return ok({ active: true, impersonation: serializeImpersonationRecord(record) })
    }
    // Marker present but session is no longer the impersonated one. Only
    // invalidate the record when the access token proves the ADMIN session
    // took over (refresh rotation mints a new sid, so `adminUserId` is the
    // stable signal). A forged marker from any other session — e.g. the
    // real target user replaying a leaked record id — must NOT kill the
    // admin's live impersonation; it just gets `active: false` and its own
    // marker cookie cleared.
    if (record && access !== null && access.uid === record.adminUserId) {
      store.end(record.id, "invalidated")
    }
    return clearImpersonationMarker(ok({ active: false, impersonation: null }))
  }

  const admin = await requireAdmin(request)
  if (admin instanceof NextResponse) return admin

  // Admin viewing status outside an impersonation: surface their most recent
  // record so the panel can show "last session ended at …".
  const adminUser = await getAuthBackend().getUserByEmail(admin.email)
  const recent = adminUser ? store.list().find((r) => r.adminUserId === adminUser.id) : undefined

  return ok({
    active: false,
    impersonation: null,
    lastImpersonation: recent ? serializeImpersonationRecordForAdmin(recent) : null,
  })
}
