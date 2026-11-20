import { cookies } from "next/headers"

import { ACCESS_COOKIE } from "@/lib/auth/http"
import { decodeMockSession, MOCK_SESSION_COOKIE, mockAuthEnabled } from "@/lib/auth/mock-session"
import { verifyAuthTokenIgnoreExpiry } from "@/lib/auth/token-codec"

/**
 * Server-side resolution of the session principal used to key onboarding
 * records (`user:<uid>` for real sessions, `mock:<email>` for mock auth).
 *
 * Precedence MUST match `resolveOnboardingIdentity` in
 * `src/app/api/onboarding/route.ts` (and `src/app/api/profile/route.ts`):
 * the `spindle_at` access token wins over the mock-session cookie, so the
 * page guard and the API always key records identically even when both
 * cookies are present.
 *
 * Reads the auth cookies via `next/headers`, so it only works in server
 * components and route handlers. The access token is verified with expiry
 * ignored (same coarse gate as `(app)/layout.tsx`): an expired-but-genuine
 * token still identifies the user, and onboarding state grants no access to
 * protected data.
 */
export async function resolveSessionPrincipal(): Promise<string | null> {
  const cookieStore = await cookies()

  const token = cookieStore.get(ACCESS_COOKIE)?.value
  if (token) {
    const payload = verifyAuthTokenIgnoreExpiry(token, "access")
    if (payload) return `user:${payload.uid}`
  }

  if (mockAuthEnabled) {
    const session = decodeMockSession(cookieStore.get(MOCK_SESSION_COOKIE)?.value)
    if (session) return `mock:${session.user.email.trim().toLowerCase()}`
  }

  return null
}
