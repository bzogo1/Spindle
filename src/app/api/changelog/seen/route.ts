import { authRateLimited, clientIp } from "@/lib/auth-endpoint-rate-limit"
import { getAuthBackend } from "@/lib/auth/backend"
import { accessTokenFromRequest, fail, isSameOriginRequest, ok, readCookie } from "@/lib/auth/http"
import { decodeMockSession, MOCK_SESSION_COOKIE, mockAuthEnabled } from "@/lib/auth/mock-session"
import { markChangelogSeen } from "@/lib/changelog-notify"
import { createRateLimiter } from "@/lib/site-forms"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * POST /api/changelog/seen — marks changelog entries seen for the caller.
 *   `{ entryId }` acknowledges everything up to that release; `{ all: true }`
 *   (or an empty body) acknowledges everything published so far. Seen state
 *   only moves forward and never affects other users.
 *
 * Session resolution mirrors `/api/messages`. State lives in the
 * process-local store in `src/lib/changelog-notify.ts`.
 */

const writeLimiter = createRateLimiter({ limit: 120, windowMs: 60 * 60 * 1000 })

const ENTRY_ID_MAX_LENGTH = 120

async function resolvePrincipal(request: Request): Promise<string | null> {
  const access = accessTokenFromRequest(request)
  if (access) {
    const user = await getAuthBackend().getUserById(access.uid)
    return user ? user.id : null
  }

  if (mockAuthEnabled) {
    const session = decodeMockSession(readCookie(request, MOCK_SESSION_COOKIE))
    if (session) {
      return `mock:${session.user.email.trim().toLowerCase()}`
    }
  }

  return null
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return fail(403, "forbidden", "Cross-origin request blocked.")
  }
  if (!writeLimiter.check(clientIp(request))) return authRateLimited()

  const principal = await resolvePrincipal(request)
  if (!principal) {
    return fail(401, "unauthenticated", "Sign in to update your changelog state.")
  }

  let body: unknown
  try {
    const text = await request.text()
    body = text ? JSON.parse(text) : {}
  } catch {
    return fail(400, "invalid_request", "Request body must be JSON.")
  }

  const { entryId, all } = (body ?? {}) as { entryId?: unknown; all?: unknown }

  if (all === true) {
    const result = markChangelogSeen(principal, null)
    return ok({ lastSeen: result.lastSeen })
  }

  if (
    typeof entryId !== "string" ||
    entryId.trim() === "" ||
    entryId.length > ENTRY_ID_MAX_LENGTH
  ) {
    return fail(
      400,
      "invalid_request",
      "Pass { entryId } for a specific release or { all: true } to mark everything seen.",
    )
  }

  const result = markChangelogSeen(principal, entryId.trim())
  if (!result.marked) {
    return fail(404, "not_found", "Changelog entry not found.")
  }
  return ok({ lastSeen: result.lastSeen })
}
