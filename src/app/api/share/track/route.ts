import { z } from "zod"

import {
  AUTH_LIMITS,
  authRateLimited,
  clientIp,
  createAuthRateLimiter,
} from "@/lib/auth-endpoint-rate-limit"
import { fail, isSameOriginRequest } from "@/lib/auth/http"
import { SHARE_PLATFORM_IDS } from "@/lib/social-share"
import { recordShareClick } from "@/lib/share-tracking"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * POST /api/share/track — record a social share click.
 *
 * Public endpoint hit by share surfaces (the `/referral` panel and the
 * in-app referral buttons) when a visitor picks a share target. Body:
 * `{ platform, code? }` where `platform` is one of `SHARE_PLATFORM_IDS`
 * (`x | linkedin | facebook | whatsapp | telegram | email | native | copy`)
 * and `code` is the optional referral code being shared.
 *
 * Always returns `204` on success — there is nothing to render, and a
 * uniform response keeps the endpoint useless for probing. Counts land in
 * the bounded in-memory store in `src/lib/share-tracking.ts` (documented
 * dev seam; upgrade path is a `share_clicks` table).
 *
 * Same-origin enforced and rate limited per IP (publicRead tier). Only
 * malformed JSON / schema violations and cross-origin requests fail.
 */

const limiter = createAuthRateLimiter(AUTH_LIMITS.publicRead)

const trackSchema = z.object({
  platform: z.enum(SHARE_PLATFORM_IDS),
  code: z.string().trim().min(1).max(64).optional(),
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

  const parsed = trackSchema.safeParse(body)
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "Invalid share tracking request."
    return fail(400, "invalid_request", message)
  }

  recordShareClick(parsed.data.platform, parsed.data.code)

  return new Response(null, { status: 204 })
}
