import { getAuthBackend } from "@/lib/auth/backend"
import { accessTokenFromRequest, fail, isSameOriginRequest, ok } from "@/lib/auth/http"
import { getTrustedDeviceStore } from "@/lib/auth/totp-devices"
import { createRateLimiter, clientIp } from "@/lib/site-forms"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const limiter = createRateLimiter({ limit: 30, windowMs: 60 * 1000 })

type Params = { params: Promise<{ id: string }> }

/**
 * DELETE /api/auth/2fa/devices/[id] — revokes one trusted device owned by the
 * caller. Scoped by userId server-side, so a device id belonging to another
 * account is indistinguishable from a missing one (404, no enumeration).
 * Revocation takes effect on the NEXT sign-in: the fingerprint simply stops
 * matching an active record and the normal TOTP challenge returns.
 */
export async function DELETE(request: Request, { params }: Params) {
  if (!isSameOriginRequest(request)) {
    return fail(403, "forbidden", "Cross-origin request blocked.")
  }
  if (!limiter.check(clientIp(request))) {
    return fail(429, "rate_limited", "Too many requests. Try again later.")
  }

  const access = accessTokenFromRequest(request)
  if (!access) return fail(401, "unauthenticated", "Sign in required.")

  const user = await getAuthBackend().getUserById(access.uid)
  if (!user) return fail(401, "unauthenticated", "Sign in required.")

  const { id } = await params
  const revoked = getTrustedDeviceStore().revoke(user.id, id)
  if (!revoked) {
    return fail(404, "not_found", "Trusted device not found.")
  }
  return ok({ revoked: true })
}
