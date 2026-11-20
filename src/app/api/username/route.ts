import { fail, isSameOriginRequest, ok } from "@/lib/auth/http"
import { clientIp, createRateLimiter } from "@/lib/site-forms"
import {
  clearUsernameForPrincipal,
  getHandleForPrincipal,
  isUsernameAvailable,
  parseUsername,
  setUsernameForPrincipal,
} from "@/lib/username"
import { resolveProfileIdentity } from "../profile/route"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// The availability lookup is unauthenticated, so it is a handle-enumeration
// oracle — cap it per client IP. Best-effort per-instance limit; see
// `createRateLimiter` in `src/lib/site-forms.ts` for caveats.
const availabilityLimiter = createRateLimiter({ limit: 30, windowMs: 60 * 1000 })

/**
 * GET/PUT /api/username — the signed-in user's @handle.
 *
 * `GET /api/username?handle=<candidate>` reports whether a candidate handle
 * is valid, unreserved, and unclaimed (`{ ok, available, username?, error? }`).
 * It is a read-only lookup and does not require a session; the authenticated
 * variant (`GET /api/username` with no `handle` param) returns the caller's
 * own handle instead.
 *
 * `PUT /api/username` with `{ "handle": "<candidate>" }` claims or changes the
 * caller's handle; `{ "handle": null }` releases it. Mutations require a
 * session and a same-origin request, matching `PUT /api/profile`.
 *
 * Handles live in the process-local registry in `src/lib/username.ts` until a
 * real profile API exists — see that module's docstring.
 */

export async function GET(request: Request) {
  const candidate = new URL(request.url).searchParams.get("handle")

  if (candidate === null) {
    // No candidate: report the caller's own handle (null when signed out).
    const identity = await resolveProfileIdentity(request)
    return ok({ handle: identity ? getHandleForPrincipal(identity.principal) : null })
  }

  if (!availabilityLimiter.check(clientIp(request))) {
    return fail(429, "rate_limited", "Too many requests. Please try again later.")
  }

  const parsed = parseUsername(candidate)
  if (!parsed.ok) {
    return ok({ available: false, error: parsed.error })
  }

  // The caller's own handle counts as available so the profile panel can
  // re-check the current value without a false "taken".
  const identity = await resolveProfileIdentity(request)
  return ok({
    available: isUsernameAvailable(parsed.username, identity?.principal),
    username: parsed.username,
  })
}

export async function PUT(request: Request) {
  if (!isSameOriginRequest(request)) {
    return fail(403, "forbidden", "Cross-origin request blocked.")
  }

  const identity = await resolveProfileIdentity(request)
  if (!identity) {
    return fail(401, "unauthenticated", "Sign in to update your username.")
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return fail(400, "invalid_request", "Request body must be JSON.")
  }

  const handle =
    typeof body === "object" && body !== null ? (body as { handle?: unknown }).handle : undefined

  if (handle === null) {
    clearUsernameForPrincipal(identity.principal)
    return ok({ handle: null })
  }

  const result = setUsernameForPrincipal(identity.principal, handle)
  if (!result.ok) {
    return fail(422, "invalid_username", result.error)
  }
  return ok({ handle: result.username })
}
