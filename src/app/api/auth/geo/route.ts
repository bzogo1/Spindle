import {
  AUTH_LIMITS,
  authRateLimited,
  clientIp,
  createAuthRateLimiter,
} from "@/lib/auth-endpoint-rate-limit"
import { getAuthBackend } from "@/lib/auth/backend"
import { accessTokenFromRequest, fail, isSameOriginRequest, ok } from "@/lib/auth/http"
import { getGeoRestrictionStore, geoRestrictionsSchema } from "@/lib/auth/geo-restrictions"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * Rate limit: `publicRead` preset (60 req/min per IP) like other read-only
 * auth endpoints; PUT is a policy write, so it shares the same per-IP budget.
 */
const limiter = createAuthRateLimiter(AUTH_LIMITS.publicRead)

/**
 * Resolves the policy owner for a request. The access token carries `uid`;
 * the backend lookup confirms the account still exists so a stale token
 * cannot read or mutate policies for a deleted user. Mirrors the helper in
 * `/api/auth/policies`.
 */
async function policyOwner(request: Request) {
  const access = accessTokenFromRequest(request)
  if (!access) return null
  const user = await getAuthBackend().getUserById(access.uid)
  return user ? { userId: user.id } : null
}

/**
 * GET /api/auth/geo — the caller's effective geographic login restriction
 * policy plus the countries observed on their sign-ins (for the
 * "you've logged in from X" UI).
 */
export async function GET(request: Request) {
  if (!limiter.check(clientIp(request))) return authRateLimited()
  const owner = await policyOwner(request)
  if (!owner) return fail(401, "unauthenticated", "Sign in required.")
  const store = getGeoRestrictionStore()
  return ok({
    policy: store.getPolicy(owner.userId),
    observedCountries: store.getObservedCountries(owner.userId),
  })
}

/**
 * PUT /api/auth/geo — replaces the caller's geographic restriction policy
 * wholesale. Body must satisfy {@link geoRestrictionsSchema} (strict);
 * country codes are normalized to uppercase, deduplicated, and sorted.
 */
export async function PUT(request: Request) {
  if (!limiter.check(clientIp(request))) return authRateLimited()
  if (!isSameOriginRequest(request)) {
    return fail(403, "forbidden", "Cross-origin request blocked.")
  }
  const owner = await policyOwner(request)
  if (!owner) return fail(401, "unauthenticated", "Sign in required.")

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return fail(400, "invalid_request", "Invalid request body.")
  }
  const parsed = geoRestrictionsSchema.safeParse(body)
  if (!parsed.success) {
    return fail(400, "invalid_request", "Invalid geographic restrictions.")
  }

  const store = getGeoRestrictionStore()
  store.setPolicy(owner.userId, parsed.data)
  return ok({
    policy: store.getPolicy(owner.userId),
    observedCountries: store.getObservedCountries(owner.userId),
  })
}
