import {
  AUTH_LIMITS,
  authRateLimited,
  clientIp,
  createAuthRateLimiter,
} from "@/lib/auth-endpoint-rate-limit"
import { createRateLimiter } from "@/lib/site-forms"
import { getAuthBackend } from "@/lib/auth/backend"
import { accessTokenFromRequest, fail, isSameOriginRequest, ok, readCookie } from "@/lib/auth/http"
import { decodeMockSession, MOCK_SESSION_COOKIE, mockAuthEnabled } from "@/lib/auth/mock-session"
import {
  listInbox,
  markAllRead,
  markRead,
  MESSAGE_ID_MAX_LENGTH,
  unreadCount,
} from "@/lib/in-app-messages"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * GET  /api/messages?unread=1&limit=N — the caller's inbox: direct messages
 *   plus broadcasts, newest first, each with the caller's read state. Also
 *   returns `unreadCount` for the header badge.
 * POST /api/messages — `{ messageId }` marks one message read, or
 *   `{ all: true }` marks the whole inbox read.
 *
 * Session resolution mirrors `GET/POST /api/support/tickets`: the
 * `spindle_at` access cookie is verified and hydrated via
 * `getAuthBackend().getUserById` (the backend row is the source of truth);
 * the `spindle_mock_session` cookie is accepted only when mock auth is
 * enabled, keyed as `mock:<email>` — the same principal strings the
 * preferences routes use. Messages live in the process-local store in
 * `src/lib/in-app-messages.ts` until a real messages table exists.
 *
 * Read state is per-principal, so marking a broadcast read here never
 * affects another user's inbox.
 */

const readLimiter = createAuthRateLimiter(AUTH_LIMITS.publicRead)
/** Read receipts are cheap but chatty; 120/hour is generous for real use. */
const writeLimiter = createRateLimiter({ limit: 120, windowMs: 60 * 60 * 1000 })

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

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

function parseLimit(raw: string | null): number | null {
  if (raw === null || raw === "") return DEFAULT_LIMIT
  if (!/^\d+$/.test(raw)) return null
  const value = Number.parseInt(raw, 10)
  if (!Number.isSafeInteger(value) || value < 1) return null
  return Math.min(value, MAX_LIMIT)
}

export async function GET(request: Request) {
  if (!readLimiter.check(clientIp(request))) return authRateLimited()

  const principal = await resolvePrincipal(request)
  if (!principal) {
    return fail(401, "unauthenticated", "Sign in to view your messages.")
  }

  const params = new URL(request.url).searchParams
  const limit = parseLimit(params.get("limit"))
  if (limit === null) {
    return fail(400, "invalid_request", "limit must be a positive integer.")
  }
  const unreadOnly = params.get("unread") === "1"

  const inbox = listInbox(principal, limit)
  const messages = unreadOnly ? inbox.filter((message) => !message.read) : inbox
  return ok({
    messages,
    unreadCount: unreadCount(principal),
    limit,
  })
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return fail(403, "forbidden", "Cross-origin request blocked.")
  }
  if (!writeLimiter.check(clientIp(request))) return authRateLimited()

  const principal = await resolvePrincipal(request)
  if (!principal) {
    return fail(401, "unauthenticated", "Sign in to update your messages.")
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return fail(400, "invalid_request", "Request body must be JSON.")
  }

  const { messageId, all } = (body ?? {}) as { messageId?: unknown; all?: unknown }

  if (all === true) {
    const marked = markAllRead(principal)
    return ok({ marked, unreadCount: unreadCount(principal) })
  }

  if (
    typeof messageId !== "string" ||
    messageId.trim() === "" ||
    messageId.length > MESSAGE_ID_MAX_LENGTH
  ) {
    return fail(
      400,
      "invalid_request",
      "messageId must be a non-empty string, or pass { all: true }.",
    )
  }

  if (!markRead(principal, messageId.trim())) {
    return fail(404, "not_found", "Message not found.")
  }
  return ok({ unreadCount: unreadCount(principal) })
}
