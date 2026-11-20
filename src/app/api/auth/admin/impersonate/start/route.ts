import { NextResponse } from "next/server"

import { requireAdmin } from "@/lib/admin-guard"
import {
  AUTH_LIMITS,
  authRateLimited,
  clientIp,
  createAuthRateLimiter,
} from "@/lib/auth-endpoint-rate-limit"
import { getAuthBackend } from "@/lib/auth/backend"
import { accessTokenFromRequest, fail, ok, readCookie } from "@/lib/auth/http"
import {
  applyImpersonationCookies,
  getImpersonationStore,
  IMPERSONATION_COOKIE,
  startImpersonation,
} from "@/lib/auth/impersonation"
import { verifyAuthToken } from "@/lib/auth/token-codec"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * POST /api/auth/admin/impersonate/start — begin a time-boxed impersonation.
 *
 * Admin-only (`requireAdmin` resolves the caller's email from the backend and
 * checks `isAdminEmail`). Body: `{ "email": "user@example.com" }` or
 * `{ "userId": "..." }` — the target is resolved through `AuthBackend`
 * (`getUserByEmail`/`getUserById`); note the admin user directory
 * (`/api/admin/users`) lists Prisma rows whose ids do NOT exist in the auth
 * backend, so email lookup is the reliable path there.
 *
 * Guards (see lib/auth/impersonation.ts): no self-impersonation, no admin
 * targets, one active impersonation per admin. On success the response swaps
 * `spindle_at` for a 30-minute token carrying the TARGET user's claims and
 * sets the `spindle_imp` marker cookie; the admin's refresh cookie is left
 * intact so stopping (or token expiry) restores their session.
 */

const limiter = createAuthRateLimiter(AUTH_LIMITS.publicRead)

const MAX_TARGET_FIELD = 320

function serialize(record: {
  id: string
  targetEmail: string
  targetName: string | null
  startedAt: string
  expiresAt: string
}) {
  return {
    id: record.id,
    targetEmail: record.targetEmail,
    targetName: record.targetName,
    startedAt: record.startedAt,
    expiresAt: record.expiresAt,
  }
}

export async function POST(request: Request) {
  if (!limiter.check(clientIp(request))) return authRateLimited()

  const admin = await requireAdmin(request)
  if (admin instanceof NextResponse) return admin

  // An impersonated session must never mint a new impersonation. requireAdmin
  // already rejects non-admin callers, but belt-and-suspenders: if the caller
  // holds an active impersonation marker, refuse regardless.
  const marker = readCookie(request, IMPERSONATION_COOKIE)
  if (marker) {
    return fail(
      409,
      "impersonation_active",
      "Stop the current impersonation session before starting another.",
    )
  }

  let body: { email?: unknown; userId?: unknown }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return fail(400, "invalid_request", "Request body must be JSON.")
  }

  const email = typeof body.email === "string" ? body.email.trim() : ""
  const userId = typeof body.userId === "string" ? body.userId.trim() : ""
  if (!email && !userId) {
    return fail(400, "invalid_request", "Provide target email or userId.")
  }
  if (email.length > MAX_TARGET_FIELD || userId.length > MAX_TARGET_FIELD) {
    return fail(400, "invalid_request", "Target identifier is too long.")
  }

  const backend = getAuthBackend()
  const [adminUser, target] = await Promise.all([
    backend.getUserByEmail(admin.email),
    email ? backend.getUserByEmail(email) : backend.getUserById(userId),
  ])
  if (!adminUser) {
    // Admin email came from ADMIN_EMAILS but has no auth-backend account —
    // cannot attribute or restore a session for them.
    return fail(403, "forbidden", "Admin access required.")
  }
  if (!target) {
    return fail(404, "target_not_found", "No user matches that email or id.")
  }

  const access = accessTokenFromRequest(request)
  // `requireAdmin` also accepts the unsigned mock-session cookie (dev mock
  // mode), in which case there is no access token and `sid` is "". That is
  // safe: `sid` is opaque to session resolution (`/api/auth/session` looks
  // up by `uid`), so the restore token still works — it just cannot be
  // tied back to a backend session row for revocation/listing.
  const adminSessionId = access?.sid ?? ""

  const result = startImpersonation({
    adminUserId: adminUser.id,
    adminEmail: adminUser.email,
    adminName: adminUser.name,
    adminSessionId,
    target,
  })
  if (!result.ok) {
    const status = result.reason === "self" ? 400 : result.reason === "admin_target" ? 403 : 409
    return fail(status, result.reason, result.message)
  }

  // Verify the minted token round-trips before committing cookies. If it
  // does not, close the record so it does not linger as a zombie "active"
  // impersonation in the audit list.
  const check = verifyAuthToken(result.accessToken, "access")
  if (!check || check.uid !== target.id) {
    getImpersonationStore().end(result.record.id, "invalidated")
    return fail(500, "internal", "Could not start impersonation.")
  }

  // Hand the client a session description for the TARGET user so it can
  // adopt the impersonated session (auth-client `acceptSession`). Without
  // this the client's refresh timer stays armed to the ADMIN session's
  // expiry and would fire mid-impersonation, rotating the admin refresh
  // token and silently restoring the admin session early.
  const context = await backend.getSessionContext(target.id)
  const session = context
    ? {
        user: context.user,
        workspace: context.workspace,
        sessionId: result.record.id,
        expiresAt: result.record.expiresAt,
      }
    : null

  return applyImpersonationCookies(ok({ impersonation: serialize(result.record), session }), {
    accessToken: result.accessToken,
    recordId: result.record.id,
  })
}
