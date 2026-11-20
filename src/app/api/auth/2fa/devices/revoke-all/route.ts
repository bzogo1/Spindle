import { getAuthBackend } from "@/lib/auth/backend"
import { accessTokenFromRequest, fail, isSameOriginRequest, ok } from "@/lib/auth/http"
import { getTrustedDeviceStore } from "@/lib/auth/totp-devices"
import { createRateLimiter, clientIp } from "@/lib/site-forms"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const limiter = createRateLimiter({ limit: 10, windowMs: 60 * 1000 })

/**
 * POST /api/auth/2fa/devices/revoke-all — revokes every trusted device for
 * the caller (the panic button: "I lost trust in all my remembered devices").
 * Idempotent: returns the number actually revoked, which may be 0.
 */
export async function POST(request: Request) {
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

  const revoked = getTrustedDeviceStore().revokeAll(user.id)
  return ok({ revoked })
}
