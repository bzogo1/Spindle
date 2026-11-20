import { z } from "zod"

import { getAuthBackend } from "@/lib/auth/backend"
import {
  AUTH_LIMITS,
  authRateLimited,
  clientIp,
  createAuthRateLimiter,
} from "@/lib/auth-endpoint-rate-limit"
import { accessTokenFromRequest, fail, isSameOriginRequest, ok, readCookie } from "@/lib/auth/http"
import { decodeMockSession, MOCK_SESSION_COOKIE, mockAuthEnabled } from "@/lib/auth/mock-session"
import { enrollUser, getProgram, isEnrolled, unenrollUser } from "@/lib/beta-access"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * POST /api/beta/[id]/enroll — self-service beta enrollment.
 *
 * Body: `{ enrolled: boolean }` — `true` enrolls the caller, `false`
 * unenrolls (idempotent both ways). Enrolling requires the program to be
 * `open` (409 `program_closed` otherwise); unenrolling is always allowed so
 * users can leave a program that was closed after they joined.
 *
 * Same-origin enforced, rate limited, auth required. Session resolution
 * matches `GET /api/beta` (access token → `getUserById`, or the mock
 * session cookie in mock-auth mode). Enrollment is keyed by the resolved
 * principal — `user:<uid>` / `mock:<email>`, same convention as
 * `/api/preferences`.
 */

const limiter = createAuthRateLimiter(AUTH_LIMITS.publicRead)

const enrollSchema = z.object({
  enrolled: z.boolean(),
})

type RouteContext = { params: Promise<{ id: string }> }

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

export async function POST(request: Request, context: RouteContext) {
  if (!isSameOriginRequest(request)) {
    return fail(403, "forbidden", "Cross-origin request blocked.")
  }
  if (!limiter.check(clientIp(request))) return authRateLimited()

  const principal = await resolvePrincipal(request)
  if (!principal) {
    return fail(401, "unauthenticated", "Sign in to manage beta enrollment.")
  }

  const { id } = await context.params
  const program = getProgram(id)
  if (!program) return fail(404, "not_found", "Beta program not found.")

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return fail(400, "invalid_request", "Request body must be JSON.")
  }

  const parsed = enrollSchema.safeParse(body)
  if (!parsed.success) {
    return fail(400, "invalid_request", "Body must be { enrolled: boolean }.")
  }

  if (parsed.data.enrolled && program.status !== "open") {
    return fail(409, "program_closed", "This beta program is closed to new enrollments.")
  }

  if (parsed.data.enrolled) {
    enrollUser(id, principal)
  } else {
    unenrollUser(id, principal)
  }

  return ok({
    programId: id,
    enrolled: isEnrolled(id, principal),
  })
}
