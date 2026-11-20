import {
  AUTH_LIMITS,
  authRateLimited,
  clientIp,
  createAuthRateLimiter,
} from "@/lib/auth-endpoint-rate-limit"
import { getAuthBackend } from "@/lib/auth/backend"
import { accessTokenFromRequest, fail, ok } from "@/lib/auth/http"
import {
  checkGeoRestriction,
  getGeoRestrictionStore,
  resolveRequestCountry,
} from "@/lib/auth/geo-restrictions"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * Rate limit: `publicRead` preset (60 req/min per IP) like other read-only
 * auth endpoints. The check is cheap but the limiter also bounds repeated
 * probing of the caller's policy verdict.
 */
const limiter = createAuthRateLimiter(AUTH_LIMITS.publicRead)

/**
 * GET /api/auth/geo/check — dry-run of the geographic restriction for the
 * CURRENT request. Resolves the caller's country from platform geo headers
 * (`cf-ipcountry` → `x-vercel-ip-country` → `x-appengine-country` →
 * `"unknown"`) and returns the {@link checkGeoRestriction} verdict against
 * the caller's effective policy.
 *
 * Deliberately PURE: it uses {@link checkGeoRestriction} directly and does
 * NOT record an observed login country. Only real sign-in evaluation
 * (`evaluateGeoRestriction`, wired into session-creation routes) may record
 * observations — otherwise every page poll would inflate the "observed
 * countries" counts shown in the UI.
 *
 * This endpoint is advisory: it never blocks. Real enforcement is wired
 * into the session-creation routes via `evaluateGeoRestriction` — see
 * `src/lib/auth/geo-restrictions.ts`.
 */
export async function GET(request: Request) {
  if (!limiter.check(clientIp(request))) return authRateLimited()

  const access = accessTokenFromRequest(request)
  if (!access) return fail(401, "unauthenticated", "Sign in required.")
  const user = await getAuthBackend().getUserById(access.uid)
  if (!user) return fail(401, "unauthenticated", "Sign in required.")

  const store = getGeoRestrictionStore()
  const country = resolveRequestCountry(request)
  const verdict = checkGeoRestriction(store.getPolicy(user.id), country)
  return ok({
    country,
    allowed: verdict.allowed,
    reason: verdict.reason,
  })
}
