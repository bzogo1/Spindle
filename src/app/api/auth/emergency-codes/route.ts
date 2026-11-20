import { getAuthBackend } from "@/lib/auth/backend"
import {
  getEmergencyCodeStatus,
  issueEmergencyCodes,
  recordEmergencyCodeEvent,
  revokeEmergencyCodes,
} from "@/lib/auth/emergency-codes"
import { accessTokenFromRequest, fail, isSameOriginRequest, ok } from "@/lib/auth/http"
import { auditContextFromRequest } from "@/lib/auth/audit"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * GET /api/auth/emergency-codes — status for the signed-in user: whether a
 * live set exists, how many unused codes remain, and when the set expires.
 * Codes are stored hashed only, so plaintext can never be listed — the count
 * is all there is.
 */
export async function GET(request: Request) {
  const access = accessTokenFromRequest(request)
  if (!access) return fail(401, "unauthenticated", "Sign in required.")

  const backend = getAuthBackend()
  const user = await backend.getUserById(access.uid)
  if (!user) return fail(401, "unauthenticated", "Sign in required.")

  return ok(getEmergencyCodeStatus(user.id))
}

/**
 * POST /api/auth/emergency-codes — issues a fresh set of emergency access
 * codes and returns the plaintext exactly once. Every previously issued code
 * stops working immediately (regenerate invalidates old).
 */
export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return fail(403, "forbidden", "Cross-origin request blocked.")

  const access = accessTokenFromRequest(request)
  if (!access) return fail(401, "unauthenticated", "Sign in required.")

  const backend = getAuthBackend()
  const user = await backend.getUserById(access.uid)
  if (!user) return fail(401, "unauthenticated", "Sign in required.")

  const issued = await issueEmergencyCodes(user.id)
  recordEmergencyCodeEvent("generated", {
    userId: user.id,
    email: user.email,
    ...auditContextFromRequest(request),
    metadata: { count: issued.codes.length, expiresAt: issued.expiresAt },
  })

  return ok({
    emergencyCodes: issued.codes,
    remaining: issued.remaining,
    expiresAt: issued.expiresAt,
  })
}

/**
 * DELETE /api/auth/emergency-codes — revokes every emergency code for the
 * signed-in user. Idempotent: revoking an unmanaged set still returns ok.
 */
export async function DELETE(request: Request) {
  if (!isSameOriginRequest(request)) return fail(403, "forbidden", "Cross-origin request blocked.")

  const access = accessTokenFromRequest(request)
  if (!access) return fail(401, "unauthenticated", "Sign in required.")

  const backend = getAuthBackend()
  const user = await backend.getUserById(access.uid)
  if (!user) return fail(401, "unauthenticated", "Sign in required.")

  const revoked = revokeEmergencyCodes(user.id)
  recordEmergencyCodeEvent("revoked", {
    userId: user.id,
    email: user.email,
    ...auditContextFromRequest(request),
    metadata: { hadSet: revoked },
  })

  return ok({ revoked })
}
