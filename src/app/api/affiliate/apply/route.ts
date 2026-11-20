import { applyForAffiliate } from "@/lib/affiliate"
import {
  AUTH_LIMITS,
  authRateLimited,
  clientIp,
  createAuthRateLimiter,
} from "@/lib/auth-endpoint-rate-limit"
import { fail, isSameOriginRequest, ok } from "@/lib/auth/http"
import { resolveAffiliateCaller } from "../caller"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * POST /api/affiliate/apply — submit an affiliate program application.
 *
 * Requires a signed-in user (`spindle_at` access cookie, mock session as the
 * dev fallback — see `../caller.ts`). Each user may hold at most one
 * affiliate account; duplicate applications and already-registered emails
 * return 409. New applications start `pending` and require admin approval
 * via `/api/admin/affiliates` before their tracking code records clicks or
 * conversions. The store is the in-memory dev seam in
 * `src/lib/affiliate.ts`; there are no real payouts.
 */

const limiter = createAuthRateLimiter(AUTH_LIMITS.publicRead)

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return fail(403, "forbidden", "Cross-origin request blocked.")
  }
  if (!limiter.check(clientIp(request))) return authRateLimited()

  const caller = await resolveAffiliateCaller(request)
  if (!caller) {
    return fail(401, "unauthenticated", "Sign in to apply for the affiliate program.")
  }
  if (!caller.email) {
    return fail(400, "invalid_request", "Your account has no email address on file.")
  }

  // The body is optional — applications carry no fields beyond identity —
  // but a JSON body, when sent, must parse so malformed clients fail loudly.
  const contentType = request.headers.get("content-type") ?? ""
  if (contentType.includes("application/json")) {
    try {
      await request.json()
    } catch {
      return fail(400, "invalid_request", "Request body must be JSON.")
    }
  }

  try {
    const account = applyForAffiliate(caller.userId, caller.email)
    return ok({ affiliate: account })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not submit application."
    if (/already applied|already registered/.test(message)) {
      return fail(409, "conflict", message)
    }
    if (/capacity/.test(message)) {
      return fail(503, "unavailable", message)
    }
    return fail(400, "invalid_request", message)
  }
}
