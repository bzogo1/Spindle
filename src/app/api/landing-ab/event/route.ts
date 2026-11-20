import { z } from "zod"

import {
  AUTH_LIMITS,
  authRateLimited,
  clientIp,
  createAuthRateLimiter,
} from "@/lib/auth-endpoint-rate-limit"
import { fail, isSameOriginRequest, ok } from "@/lib/auth/http"
import { LANDING_AB_EVENT_TYPES, recordEvent } from "@/lib/landing-ab"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * POST /api/landing-ab/event — record a landing A/B experiment event.
 *
 * Public endpoint hit by experiment-aware surfaces after they resolve an
 * assignment. Body: `{ experimentId, variantId?, visitorId, type }` where
 * `type` is one of `view | signup_click | cta_click`.
 *
 * Validation failures and unknown experiment/variant ids return 400/404 —
 * events are analytics, not security-sensitive, but malformed payloads are
 * still rejected so the store stays clean. Rate limited per IP
 * (publicRead tier) and same-origin enforced. The store is the in-memory
 * dev seam described in `src/lib/landing-ab.ts`.
 */

const limiter = createAuthRateLimiter(AUTH_LIMITS.publicRead)

const eventSchema = z.object({
  experimentId: z.string().trim().min(1).max(120),
  variantId: z.string().trim().min(1).max(120).optional(),
  visitorId: z.string().trim().min(1).max(128),
  type: z.enum(LANDING_AB_EVENT_TYPES),
})

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return fail(403, "forbidden", "Cross-origin request blocked.")
  }
  if (!limiter.check(clientIp(request))) return authRateLimited()

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return fail(400, "invalid_request", "Request body must be JSON.")
  }

  const parsed = eventSchema.safeParse(body)
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "Invalid event request."
    return fail(400, "invalid_request", message)
  }

  try {
    recordEvent({
      experimentId: parsed.data.experimentId,
      ...(parsed.data.variantId ? { variantId: parsed.data.variantId } : {}),
      visitorId: parsed.data.visitorId,
      type: parsed.data.type,
    })
    return ok({ recorded: true })
  } catch (error) {
    const code = error instanceof Error && "code" in error ? (error as { code: string }).code : ""
    if (code === "not_found") {
      return fail(404, "not_found", "Experiment not found.")
    }
    return fail(400, "invalid_request", error instanceof Error ? error.message : "Invalid event.")
  }
}
