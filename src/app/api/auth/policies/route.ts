import { getAuthBackend } from "@/lib/auth/backend"
import { accessTokenFromRequest, fail, isSameOriginRequest, ok } from "@/lib/auth/http"
import { getSecurityPolicyStore, securityPoliciesSchema } from "@/lib/auth/security-policies"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * Resolves the policy owner for a request. The access token carries `uid`;
 * the backend lookup confirms the account still exists so a stale token
 * cannot read or mutate policies for a deleted user.
 */
async function policyOwner(request: Request) {
  const access = accessTokenFromRequest(request)
  if (!access) return null
  const user = await getAuthBackend().getUserById(access.uid)
  return user ? { userId: user.id } : null
}

/**
 * GET /api/auth/policies — the caller's effective login security policies
 * (per-user overrides merged over the global layer and defaults).
 */
export async function GET(request: Request) {
  const owner = await policyOwner(request)
  if (!owner) return fail(401, "unauthenticated", "Sign in required.")
  return ok({ policies: getSecurityPolicyStore().getPolicies(owner.userId) })
}

/**
 * PUT /api/auth/policies — replaces the caller's policy object wholesale.
 * Body must satisfy {@link securityPoliciesSchema}; every field is required
 * so the client always sends a complete policy (use `null` for "no limit").
 */
export async function PUT(request: Request) {
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
  const parsed = securityPoliciesSchema.safeParse(body)
  if (!parsed.success) {
    return fail(400, "invalid_request", "Invalid security policies.")
  }

  const store = getSecurityPolicyStore()
  store.setPolicies(owner.userId, parsed.data)
  // Return the effective (merged) policy — same shape GET returns.
  return ok({ policies: store.getPolicies(owner.userId) })
}
