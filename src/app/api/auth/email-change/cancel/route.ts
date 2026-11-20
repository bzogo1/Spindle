import { fail, isSameOriginRequest, ok } from "@/lib/auth/http"
import { cancelEmailChange, resolveEmailChangeIdentity } from "@/lib/email-change"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * POST /api/auth/email-change/cancel — drops the pending change so its
 * emailed link stops working. Idempotent: returns `cancelled: false` when
 * nothing was pending rather than an error.
 */
export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return fail(403, "forbidden", "Cross-origin request blocked.")
  }

  const identity = await resolveEmailChangeIdentity(request)
  if (!identity) {
    return fail(401, "unauthenticated", "Sign in to manage your email change.")
  }

  return ok({ cancelled: cancelEmailChange(identity.principal) })
}
