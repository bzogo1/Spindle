import { NextResponse } from "next/server"

import { getAuthBackend, type AuthUser } from "@/lib/auth/backend"
import { isAdminEmail } from "@/lib/admin"
import {
  authRateLimited,
  AUTH_LIMITS,
  clientIp,
  createAuthRateLimiter,
} from "@/lib/auth-endpoint-rate-limit"
import {
  auditContextFromRequest,
  recordAuthEvent,
  type AuthAuditEventInput,
} from "@/lib/auth/audit"
import { accessTokenFromRequest, fail, isSameOriginRequest, ok } from "@/lib/auth/http"
import { getForcedResetStore } from "@/lib/auth/forced-reset"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * Admin management of the forced-password-reset flag.
 *
 *  - `POST /api/auth/forced-reset` `{ userId | email, reason? }` — marks the
 *    account as requiring a password reset. The next credential sign-in is
 *    refused with `403 password_reset_required` until the user completes
 *    `/api/auth/password/reset/confirm`, which is the only path that clears
 *    the flag.
 *  - `DELETE /api/auth/forced-reset` `{ userId | email }` — lifts the flag
 *    without a password reset (e.g. flag set by mistake).
 *
 * Authorization: the caller must hold a valid access token whose user is an
 * admin per `isAdminEmail` (`ADMIN_EMAILS` env — see src/lib/admin.ts).
 * Exactly one of `userId`/`email` must be supplied; the target is resolved
 * server-side so a client can never flag an arbitrary string.
 */

// Admin operations are rare; the fast token-consume tier is plenty and keeps
// brute-force probing of the admin surface cheap to rate-limit.
const limiter = createAuthRateLimiter(AUTH_LIMITS.tokenConsumeFast)

type TargetBody = { userId?: unknown; email?: unknown; reason?: unknown }

function parseTarget(
  body: TargetBody,
): { ok: true; userId?: string; email?: string; reason?: string } | { ok: false } {
  const userId = typeof body.userId === "string" ? body.userId.trim() : ""
  const email = typeof body.email === "string" ? body.email.trim() : ""
  if ((userId === "") === (email === "")) return { ok: false }
  const reason = typeof body.reason === "string" ? body.reason.trim() : ""
  return {
    ok: true,
    ...(userId ? { userId } : {}),
    ...(email ? { email } : {}),
    ...(reason ? { reason } : {}),
  }
}

async function requireAdmin(request: Request): Promise<AuthUser | NextResponse> {
  const access = accessTokenFromRequest(request)
  if (!access) return fail(401, "unauthorized", "Sign in required.")
  const user = await getAuthBackend().getUserById(access.uid)
  if (!user) return fail(401, "unauthorized", "Sign in required.")
  if (!isAdminEmail(user.email)) return fail(403, "forbidden", "Admin access required.")
  return user
}

function isResponse(value: AuthUser | NextResponse): value is NextResponse {
  return value instanceof NextResponse
}

async function resolveTarget(body: { userId?: string; email?: string }): Promise<AuthUser | null> {
  const backend = getAuthBackend()
  if (body.userId) return backend.getUserById(body.userId)
  return backend.getUserByEmail(body.email ?? "")
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return fail(403, "forbidden", "Cross-origin request blocked.")
  if (!limiter.check(clientIp(request))) return authRateLimited()

  const admin = await requireAdmin(request)
  if (isResponse(admin)) return admin

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return fail(400, "invalid_request", "Invalid request body.")
  }
  const parsed = parseTarget((body ?? {}) as TargetBody)
  if (!parsed.ok) {
    return fail(400, "invalid_request", "Provide exactly one of userId or email.")
  }

  const target = await resolveTarget(parsed)
  if (!target) return fail(404, "user_not_found", "No account matches the given identifier.")

  const flag = getForcedResetStore().require(target.id, {
    reason: parsed.reason,
    setBy: admin.email,
  })
  // The `AuthAuditEventType` union in ./audit does not yet include the
  // forced-reset types, so the literals are cast — the runtime store accepts
  // any string (same pattern as emergency-code events).
  recordAuthEvent({
    type: "forced_reset.set" as unknown as AuthAuditEventInput["type"],
    userId: target.id,
    email: target.email,
    ...auditContextFromRequest(request),
    metadata: { admin: admin.email, ...(parsed.reason ? { reason: parsed.reason } : {}) },
  })
  return ok({ userId: target.id, ...flag })
}

export async function DELETE(request: Request) {
  if (!isSameOriginRequest(request)) return fail(403, "forbidden", "Cross-origin request blocked.")
  if (!limiter.check(clientIp(request))) return authRateLimited()

  const admin = await requireAdmin(request)
  if (isResponse(admin)) return admin

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return fail(400, "invalid_request", "Invalid request body.")
  }
  const parsed = parseTarget((body ?? {}) as TargetBody)
  if (!parsed.ok) {
    return fail(400, "invalid_request", "Provide exactly one of userId or email.")
  }

  const target = await resolveTarget(parsed)
  if (!target) return fail(404, "user_not_found", "No account matches the given identifier.")

  getForcedResetStore().clear(target.id)
  recordAuthEvent({
    type: "forced_reset.cleared" as unknown as AuthAuditEventInput["type"],
    userId: target.id,
    email: target.email,
    ...auditContextFromRequest(request),
    metadata: { admin: admin.email },
  })
  return ok({ required: false, userId: target.id })
}
