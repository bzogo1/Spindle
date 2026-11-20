import { isAdminEmail } from "@/lib/admin"
import { getAuthBackend } from "@/lib/auth/backend"
import { accessTokenFromRequest, readCookie } from "@/lib/auth/http"
import { decodeMockSession, MOCK_SESSION_COOKIE, mockAuthEnabled } from "@/lib/auth/mock-session"

/**
 * Session resolution shared by `/api/announcements` and
 * `/api/announcements/dismiss`.
 *
 * Mirrors `resolvePrincipal` in `/api/preferences`: the `spindle_at` access
 * cookie is verified with `verifyAuthToken` (expiry enforced) and the user
 * record is loaded via `getAuthBackend().getUserById` so the admin check
 * uses the stored email — never the token claim alone. The unsigned
 * `spindle_mock_session` cookie is honoured only when mock auth is enabled.
 *
 * Returns the dismissal principal (`user:<uid>` / `mock:<email>`) plus the
 * resolved admin flag for audience filtering.
 */
export interface AnnouncementSession {
  principal: string
  isAdmin: boolean
}

export async function resolveAnnouncementSession(
  request: Request,
): Promise<AnnouncementSession | null> {
  const access = accessTokenFromRequest(request)
  if (access) {
    const user = await getAuthBackend().getUserById(access.uid)
    if (!user) return null
    return {
      principal: `user:${access.uid}`,
      isAdmin: isAdminEmail(user.email),
    }
  }

  if (mockAuthEnabled) {
    const session = decodeMockSession(readCookie(request, MOCK_SESSION_COOKIE))
    if (session) {
      const email = session.user.email.trim().toLowerCase()
      return {
        principal: `mock:${email}`,
        isAdmin: isAdminEmail(email),
      }
    }
  }

  return null
}
