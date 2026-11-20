import { getAuthBackend } from "@/lib/auth/backend"
import {
  AUTH_LIMITS,
  authRateLimited,
  clientIp,
  createAuthRateLimiter,
} from "@/lib/auth-endpoint-rate-limit"
import { accessTokenFromRequest, fail, ok, readCookie } from "@/lib/auth/http"
import { decodeMockSession, MOCK_SESSION_COOKIE, mockAuthEnabled } from "@/lib/auth/mock-session"
import { betaProgramJson, isEnrolled, listPrograms } from "@/lib/beta-access"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * GET /api/beta — the signed-in user's beta programs.
 *
 * Returns every `open` program plus any closed program the caller is
 * already enrolled in (so they can still unenroll), each with an
 * `enrolled` flag for the caller. Closed programs the caller has not
 * joined stay hidden from self-service.
 *
 * Session resolution mirrors `GET /api/announcements`: the `spindle_at`
 * access token is verified and the user record loaded via
 * `getAuthBackend().getUserById` — the stored row is the source of truth.
 * The unsigned `spindle_mock_session` cookie is honoured only when mock
 * auth is enabled. Enrollment is keyed by the resolved principal —
 * `user:<uid>` for real sessions, `mock:<email>` for mock auth (same
 * convention as `/api/preferences` and `/api/announcements`).
 */

const limiter = createAuthRateLimiter(AUTH_LIMITS.publicRead)

/** The enrollment key for the caller, or null when unauthenticated. */
async function resolvePrincipal(request: Request): Promise<string | null> {
  const access = accessTokenFromRequest(request)
  if (access) {
    const user = await getAuthBackend()
      .getUserById(access.uid)
      .catch(() => null)
    if (!user) return null
    return `user:${access.uid}`
  }

  if (mockAuthEnabled) {
    const session = decodeMockSession(readCookie(request, MOCK_SESSION_COOKIE))
    if (session) {
      return `mock:${session.user.email.trim().toLowerCase()}`
    }
  }

  return null
}

export async function GET(request: Request) {
  if (!limiter.check(clientIp(request))) return authRateLimited()

  const principal = await resolvePrincipal(request)
  if (!principal) {
    return fail(401, "unauthenticated", "Sign in to view beta programs.")
  }

  const programs = listPrograms()
    .filter((program) => program.status === "open" || isEnrolled(program.id, principal))
    .map((program) => ({
      ...betaProgramJson(program),
      enrolled: isEnrolled(program.id, principal),
    }))

  return ok({ programs })
}
