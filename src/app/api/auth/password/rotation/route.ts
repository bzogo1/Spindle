import { getAuthBackend } from "@/lib/auth/backend"
import { accessTokenFromRequest, fail, isSameOriginRequest, ok } from "@/lib/auth/http"
import {
  getPasswordRotationStatus,
  getPasswordRotationStore,
  passwordRotationPolicySchema,
} from "@/lib/password-rotation"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * Resolves the policy owner for a request. The access token carries `uid`;
 * the backend lookup confirms the account still exists so a stale token
 * cannot read or mutate policies for a deleted user.
 */
async function rotationOwner(request: Request) {
  const access = accessTokenFromRequest(request)
  if (!access) return null
  const user = await getAuthBackend().getUserById(access.uid)
  return user ? { userId: user.id } : null
}

/**
 * GET /api/auth/password/rotation — the caller's password rotation policy
 * plus the live status (expiry instant, days remaining, change required,
 * last-changed timestamp, history size).
 */
export async function GET(request: Request) {
  const owner = await rotationOwner(request)
  if (!owner) return fail(401, "unauthenticated", "Sign in required.")
  return ok({
    policy: getPasswordRotationStore().getRecord(owner.userId).policy,
    status: getPasswordRotationStatus(owner.userId),
  })
}

/**
 * PUT /api/auth/password/rotation — replaces the caller's rotation policy.
 * Body must satisfy {@link passwordRotationPolicySchema}; both fields are
 * required so the client always sends a complete policy.
 */
export async function PUT(request: Request) {
  if (!isSameOriginRequest(request)) {
    return fail(403, "forbidden", "Cross-origin request blocked.")
  }
  const owner = await rotationOwner(request)
  if (!owner) return fail(401, "unauthenticated", "Sign in required.")

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return fail(400, "invalid_request", "Invalid request body.")
  }
  const parsed = passwordRotationPolicySchema.safeParse(body)
  if (!parsed.success) {
    return fail(400, "invalid_request", "Invalid password rotation policy.")
  }

  const store = getPasswordRotationStore()
  const record = store.setPolicy(owner.userId, parsed.data)
  return ok({
    policy: record.policy,
    status: getPasswordRotationStatus(owner.userId),
  })
}
