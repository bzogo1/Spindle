import { z } from "zod"

import {
  AUTH_LIMITS,
  authRateLimited,
  clientIp,
  createAuthRateLimiter,
} from "@/lib/auth-endpoint-rate-limit"
import { fail, isSameOriginRequest, ok } from "@/lib/auth/http"
import { recordAttribution } from "@/lib/referral-program"
import { resolveReferralCaller } from "../caller"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * POST /api/referral/attribution — record a referral click/signup.
 *
 * Public endpoint hit by referral surfaces (the `/r/[code]` landing page,
 * `?ref=` trackers, and the in-app referral screen) when a `SPN-…` code is
 * consumed. Body: `{ code }` — any client-supplied `source` field is
 * ignored. This endpoint ALWAYS records `source: "click"`:
 * `"signup"`/`"manual"` attributions are reserved for trusted server-side
 * callers that invoke `recordAttribution` directly (e.g. a future
 * signup-completion hook), so anonymous traffic cannot forge attributed
 * signups or fill the attribution store with non-click records.
 *
 * When the caller happens to be signed in, `referredUserId` is bound so
 * self-referrals and duplicate per-user attributions are rejected by the
 * store; anonymous callers record unattributed clicks.
 *
 * RESPONSE POLICY: every well-formed request gets the same `200
 * { recorded: true }` — unknown codes, self-referrals, duplicates, and a
 * disabled program are all recorded-or-dropped identically so the endpoint
 * cannot be used to enumerate which `SPN-…` codes exist (matching how
 * `/r/[code]` renders the same pitch for valid and self codes). Only
 * malformed JSON / schema violations and cross-origin requests fail.
 *
 * Rate limited per IP (publicRead tier) and same-origin enforced. The store
 * is the in-memory dev seam in `src/lib/referral-program.ts`.
 */

const limiter = createAuthRateLimiter(AUTH_LIMITS.publicRead)

const attributionSchema = z.object({
  code: z.string().trim().min(1).max(64),
  // `source` is deliberately absent: zod strips unknown keys, so a
  // client-supplied source is ignored and the server always records "click".
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

  const parsed = attributionSchema.safeParse(body)
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "Invalid attribution request."
    return fail(400, "invalid_request", message)
  }

  // Best-effort caller binding: signed-in referred users get duplicate /
  // self-referral enforcement; failures degrade to an anonymous click.
  const caller = await resolveReferralCaller(request).catch(() => null)

  // Unknown codes, self-referrals, duplicates, and a disabled program all
  // resolve inside `recordAttribution` without throwing; the result is
  // intentionally discarded so the response is uniform (anti-enumeration).
  recordAttribution({
    code: parsed.data.code,
    source: "click",
    referredUserId: caller?.userId ?? null,
  })

  return ok({ recorded: true })
}
