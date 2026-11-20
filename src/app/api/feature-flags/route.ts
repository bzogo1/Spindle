import {
  AUTH_LIMITS,
  authRateLimited,
  clientIp,
  createAuthRateLimiter,
} from "@/lib/auth-endpoint-rate-limit"
import { getAuthBackend } from "@/lib/auth/backend"
import { accessTokenFromRequest, fail, ok, readCookie } from "@/lib/auth/http"
import { decodeMockSession, MOCK_SESSION_COOKIE, mockAuthEnabled } from "@/lib/auth/mock-session"
import { listEnabledFlagKeys, type FlagSubject } from "@/lib/feature-flags"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * GET /api/feature-flags — the feature flag keys enabled for the signed-in
 * caller. This is the client-facing counterpart of the admin-managed store
 * in `src/lib/feature-flags.ts`: client components should call this endpoint
 * (or a wrapper around it) rather than importing the server store directly.
 *
 * Evaluation uses `listEnabledFlagKeys` — a flag is returned when it is
 * enabled AND the caller matches its targeting rules (explicit
 * `targetUserIds`/`targetEmails`, or `rolloutPercent` bucketed on the
 * caller's user id / email). See `src/lib/feature-flags.ts` for the exact
 * semantics.
 *
 * Auth: `spindle_at` access token (user record via the auth backend) or the
 * mock-session cookie in mock-auth mode. Anonymous callers get 401.
 *
 * Data source: the in-memory dev seam in `src/lib/feature-flags.ts`
 * (per-instance, lost on restart).
 */

const limiter = createAuthRateLimiter(AUTH_LIMITS.publicRead)

/**
 * Resolves the flag-evaluation subject for the caller. Mirrors
 * `resolveAnnouncementSession` in `/api/announcements/session.ts`: the
 * verified access token's uid is hydrated through the auth backend so the
 * stored email — never the token claim alone — feeds targeting rules. The
 * unsigned mock-session cookie is honoured only when mock auth is enabled.
 */
async function resolveFlagSubject(request: Request): Promise<FlagSubject | null> {
  const access = accessTokenFromRequest(request)
  if (access) {
    const user = await getAuthBackend().getUserById(access.uid)
    if (!user) return null
    return { userId: user.id, email: user.email }
  }

  if (mockAuthEnabled) {
    const session = decodeMockSession(readCookie(request, MOCK_SESSION_COOKIE))
    if (session) return { email: session.user.email }
  }

  return null
}

export async function GET(request: Request) {
  if (!limiter.check(clientIp(request))) return authRateLimited()

  const subject = await resolveFlagSubject(request)
  if (!subject) {
    return fail(401, "unauthenticated", "Sign in to read feature flags.")
  }

  return ok({ flags: listEnabledFlagKeys(subject) })
}
