import { ACCESS_COOKIE, readCookie } from "@/lib/auth/http"
import { decodeMockSession, MOCK_SESSION_COOKIE, mockAuthEnabled } from "@/lib/auth/mock-session"
import { verifyAuthTokenIgnoreExpiry } from "@/lib/auth/token-codec"

/**
 * Resolves the notification-stream principal for a request — the channel key
 * the hub fans events out to.
 *
 * Mirrors the two-mode gate in `src/app/(app)/layout.tsx`:
 *  - Real auth: the `spindle_at` access cookie. Expiry is intentionally not
 *    enforced — the layout treats a signed-but-expired token as proof of a
 *    real session (the client provider refreshes it), and this channel only
 *    ever carries the caller's own feed.
 *  - Mock auth (`NEXT_PUBLIC_MOCK_AUTH=1`): the `spindle_mock_session`
 *    cookie, keyed by the mock user's email so different mock users get
 *    separate channels.
 *
 * Returns null when the request carries no recognizable session; callers
 * answer 401. Server-only.
 */
export function notificationPrincipalFromRequest(request: Request): string | null {
  const accessToken = readCookie(request, ACCESS_COOKIE)
  if (accessToken) {
    const payload = verifyAuthTokenIgnoreExpiry(accessToken, "access")
    if (payload) return `user:${payload.uid}`
  }

  if (mockAuthEnabled) {
    const session = decodeMockSession(readCookie(request, MOCK_SESSION_COOKIE))
    if (session) return `mock:${session.user.email.trim().toLowerCase()}`
  }

  return null
}

/**
 * Same session resolution as `notificationPrincipalFromRequest`, but returns
 * the account email address for outbound mail (digest endpoint). Returns null
 * when the request carries no recognizable session; callers answer 401.
 * Server-only.
 */
export function notificationRecipientFromRequest(request: Request): string | null {
  const accessToken = readCookie(request, ACCESS_COOKIE)
  if (accessToken) {
    const payload = verifyAuthTokenIgnoreExpiry(accessToken, "access")
    if (payload?.email) return payload.email.trim().toLowerCase()
  }

  if (mockAuthEnabled) {
    const session = decodeMockSession(readCookie(request, MOCK_SESSION_COOKIE))
    if (session) return session.user.email.trim().toLowerCase()
  }

  return null
}
