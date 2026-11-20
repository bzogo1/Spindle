import { z } from "zod"

import {
  AUTH_LIMITS,
  authRateLimited,
  clientIp,
  createAuthRateLimiter,
} from "@/lib/auth-endpoint-rate-limit"
import { fail, isSameOriginRequest, ok } from "@/lib/auth/http"
import { dismissAnnouncement } from "@/lib/announcements"

import { resolveAnnouncementSession } from "../session"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * POST /api/announcements/dismiss — `{ id }` records that the signed-in
 * caller dismissed that announcement. Idempotent: dismissing the same id
 * twice, or an unknown id, still returns `ok`.
 *
 * Same-origin enforced (cookie-authenticated mutation) and rate limited;
 * auth resolution is shared with `GET /api/announcements` (`../session.ts`).
 * Dismissals live in the in-memory dev seam in `src/lib/announcements.ts`.
 */

const limiter = createAuthRateLimiter(AUTH_LIMITS.publicRead)

const dismissSchema = z.object({
  id: z.string().trim().min(1, "Announcement id is required.").max(100),
})

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return fail(403, "forbidden", "Cross-origin request blocked.")
  }
  if (!limiter.check(clientIp(request))) return authRateLimited()

  const session = await resolveAnnouncementSession(request)
  if (!session) {
    return fail(401, "unauthenticated", "Sign in to dismiss announcements.")
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return fail(400, "invalid_request", "Request body must be JSON.")
  }

  const parsed = dismissSchema.safeParse(body)
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "Invalid request."
    return fail(400, "invalid_request", message)
  }

  dismissAnnouncement(session.principal, parsed.data.id)
  return ok({ dismissed: true })
}
