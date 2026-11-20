import { getAuthBackend } from "@/lib/auth/backend"
import { getDeviceTrustStore } from "@/lib/auth/device-trust"
import { accessTokenFromRequest, fail, isSameOriginRequest, ok } from "@/lib/auth/http"
import { clientIp, createRateLimiter } from "@/lib/site-forms"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const limiter = createRateLimiter({ limit: 30, windowMs: 60 * 1000 })

type Params = { params: Promise<{ id: string }> }

/**
 * DELETE /api/auth/device-trust/[id] — revokes one device-trust grant owned
 * by the caller. Scoped by userId server-side, so a grant id belonging to
 * another account is indistinguishable from a missing one (404, no
 * enumeration). Revocation takes effect on the NEXT sign-in: the fingerprint
 * simply stops matching an active grant and full friction checks return.
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
  const revoked = getDeviceTrustStore().revoke(user.id, id)
  if (!revoked) {
    return fail(404, "not_found", "Trusted device not found.")
  }
  return ok({ revoked: true })
}
