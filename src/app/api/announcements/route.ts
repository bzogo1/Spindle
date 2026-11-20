import {
  AUTH_LIMITS,
  authRateLimited,
  clientIp,
  createAuthRateLimiter,
} from "@/lib/auth-endpoint-rate-limit"
import { fail, ok } from "@/lib/auth/http"
import { listActiveAnnouncements } from "@/lib/announcements"

import { resolveAnnouncementSession } from "./session"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * GET /api/announcements — active feature announcements for the signed-in
 * caller: published, inside their `[startsAt, endsAt]` window, audience-
 * matched, and not dismissed by this user. Newest first.
 *
 * Auth: `spindle_at` access token (user record via the auth backend) or the
 * mock-session cookie in mock-auth mode — see `./session.ts`.
 *
 * Data source: the in-memory dev seam in `src/lib/announcements.ts`
 * (per-instance, lost on restart).
 */

const limiter = createAuthRateLimiter(AUTH_LIMITS.publicRead)

export async function GET(request: Request) {
  if (!limiter.check(clientIp(request))) return authRateLimited()

  const session = await resolveAnnouncementSession(request)
  if (!session) {
    return fail(401, "unauthenticated", "Sign in to view announcements.")
  }

  return ok({
    announcements: listActiveAnnouncements(session.principal, session.isAdmin),
  })
}
