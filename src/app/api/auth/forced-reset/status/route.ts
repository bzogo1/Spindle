import { getAuthBackend } from "@/lib/auth/backend"
import {
  authRateLimited,
  AUTH_LIMITS,
  clientIp,
  createAuthRateLimiter,
} from "@/lib/auth-endpoint-rate-limit"
import { accessTokenFromRequest, fail, ok } from "@/lib/auth/http"
import { getForcedResetStore } from "@/lib/auth/forced-reset"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * GET /api/auth/forced-reset/status — the signed-in user's own forced-reset
 * flag. Drives the app-wide `ForcedResetBanner`; always scoped to the
 * caller's `uid` from the verified access token, so it can never leak
 * another user's flag state.
 *
 * Rate limit: `publicRead` preset like other read-only auth endpoints.
 */

const limiter = createAuthRateLimiter(AUTH_LIMITS.publicRead)

export async function GET(request: Request) {
  if (!limiter.check(clientIp(request))) return authRateLimited()

  const access = accessTokenFromRequest(request)
  if (!access) return fail(401, "unauthorized", "Sign in required.")

  const user = await getAuthBackend().getUserById(access.uid)
  if (!user) return fail(401, "unauthorized", "Sign in required.")

  const flag = getForcedResetStore().get(user.id)
  if (!flag) return ok({ required: false })
  return ok({
    required: true,
    reason: flag.reason,
    setBy: flag.setBy,
    setAt: flag.setAt,
  })
}
