import { getAuthBackend } from "@/lib/auth/backend"
import { accessTokenFromRequest, readCookie } from "@/lib/auth/http"
import { decodeMockSession, MOCK_SESSION_COOKIE, mockAuthEnabled } from "@/lib/auth/mock-session"

/**
 * Resolves the signed-in referral caller for `/api/referral/*` routes.
 *
 * Mirrors `resolveAffiliateCaller` (`src/app/api/affiliate/caller.ts`) and
 * the session resolution in `GET/PUT /api/profile`: the `spindle_at` access
 * cookie is verified with `verifyAuthToken` (expiry enforced) and hydrated
 * through the auth backend; when the backend has no row for the token's uid
 * (e.g. tests minting tokens directly) it degrades to the token claims
 * rather than a 401. The unsigned `spindle_mock_session` cookie is used
 * only when mock auth is enabled.
 */
export interface ReferralCaller {
  /** Stable per-user key referral codes/attributions are indexed by. */
  userId: string
  email: string
}

export async function resolveReferralCaller(request: Request): Promise<ReferralCaller | null> {
  const access = accessTokenFromRequest(request)
  if (access) {
    const user = await getAuthBackend()
      .getUserById(access.uid)
      .catch(() => null)
    return {
      userId: user?.id ?? access.uid,
      email: (user?.email ?? access.email ?? "").trim().toLowerCase(),
    }
  }

  if (mockAuthEnabled) {
    const session = decodeMockSession(readCookie(request, MOCK_SESSION_COOKIE))
    if (session?.user.email) {
      const email = session.user.email.trim().toLowerCase()
      return { userId: `mock:${email}`, email }
    }
  }

  return null
}
