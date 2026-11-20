import { getAuthBackend } from "@/lib/auth/backend"
import { accessTokenFromRequest, fail, isSameOriginRequest, ok, readCookie } from "@/lib/auth/http"
import { decodeMockSession, MOCK_SESSION_COOKIE, mockAuthEnabled } from "@/lib/auth/mock-session"
import {
  fallbackDisplayName,
  getProfileOverride,
  parseDisplayName,
  setProfileOverride,
  type ProfileData,
} from "@/lib/profile"
import { getEffectiveEmail } from "@/lib/email-change"
import { getHandleForPrincipal } from "@/lib/username"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * GET/PUT /api/profile — the signed-in user's display profile.
 *
 * Session resolution follows the same two-mode shape as
 * `notificationPrincipalFromRequest` (`src/lib/notifications/principal.ts`)
 * but is stricter for real auth: it verifies the `spindle_at` access cookie
 * with `verifyAuthToken` (expiry enforced) and hydrates the user through the
 * auth backend, falling back to the `spindle_mock_session` cookie only when
 * mock auth is enabled.
 *
 * `memberSince` comes from the auth backend's user record for real sessions
 * and from the mock session's `signedInAt` for mock sessions; it is null when
 * the session source has no creation timestamp. Display-name edits are kept
 * in the process-local override map in `src/lib/profile.ts` until a real
 * profile endpoint exists.
 */

export type ProfileIdentity = {
  /** Stable per-user key the override map is indexed by. */
  principal: string
  name: string | null
  email: string
  memberSince: string | null
}

export async function resolveProfileIdentity(request: Request): Promise<ProfileIdentity | null> {
  const access = accessTokenFromRequest(request)
  if (access) {
    // The token already carries uid/email/name; the backend lookup adds the
    // account creation date. A missing user row (e.g. tests that mint tokens
    // directly) degrades to token claims rather than a 401.
    const user = await getAuthBackend()
      .getUserById(access.uid)
      .catch(() => null)
    return {
      principal: `user:${access.uid}`,
      name: user?.name ?? access.name,
      email: user?.email ?? access.email,
      memberSince: user?.createdAt ?? null,
    }
  }

  if (mockAuthEnabled) {
    const session = decodeMockSession(readCookie(request, MOCK_SESSION_COOKIE))
    if (session) {
      return {
        principal: `mock:${session.user.email.trim().toLowerCase()}`,
        name: session.user.name,
        email: session.user.email,
        memberSince: session.signedInAt,
      }
    }
  }

  return null
}

function profilePayload(identity: ProfileIdentity): ProfileData {
  const override = getProfileOverride(identity.principal)
  const sessionName = identity.name?.trim()
  return {
    name: override?.name ?? (sessionName ? sessionName : fallbackDisplayName(identity.email)),
    // Confirmed email changes live in the email-change override map until a
    // real profile API exists — display surfaces read the effective address.
    email: getEffectiveEmail(identity.principal, identity.email),
    handle: getHandleForPrincipal(identity.principal),
    memberSince: identity.memberSince,
  }
}

export async function GET(request: Request) {
  const identity = await resolveProfileIdentity(request)
  if (!identity) {
    return fail(401, "unauthenticated", "Sign in to view your profile.")
  }
  return ok({ profile: profilePayload(identity) })
}

export async function PUT(request: Request) {
  if (!isSameOriginRequest(request)) {
    return fail(403, "forbidden", "Cross-origin request blocked.")
  }

  const identity = await resolveProfileIdentity(request)
  if (!identity) {
    return fail(401, "unauthenticated", "Sign in to update your profile.")
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return fail(400, "invalid_request", "Request body must be JSON.")
  }

  const parsed = parseDisplayName(
    typeof body === "object" && body !== null ? (body as { name?: unknown }).name : undefined,
  )
  if (!parsed.ok) {
    return fail(422, "invalid_name", parsed.error)
  }

  setProfileOverride(identity.principal, parsed.name)
  return ok({ profile: profilePayload(identity) })
}
