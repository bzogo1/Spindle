import { accessTokenFromRequest, fail, isSameOriginRequest, ok, readCookie } from "@/lib/auth/http"
import { decodeMockSession, MOCK_SESSION_COOKIE, mockAuthEnabled } from "@/lib/auth/mock-session"
import {
  communicationPreferencesUpdateSchema,
  getCommunicationPreferences,
  updateCommunicationPreferences,
  type CommunicationPreferences,
} from "@/lib/communication-preferences"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * GET/PUT /api/communication-preferences — the signed-in user's outbound
 * communication opt-ins (email categories, digest cadence).
 *
 * Session resolution mirrors `GET/PUT /api/profile`
 * (`src/app/api/profile/route.ts`): the `spindle_at` access cookie is
 * verified with `verifyAuthToken` (expiry enforced), and the
 * `spindle_mock_session` cookie is used only when mock auth is enabled.
 * Preferences are keyed by the same principal strings (`user:<id>` /
 * `mock:<email>`) and kept in the process-local store in
 * `src/lib/communication-preferences.ts` until a real preferences endpoint
 * exists.
 *
 * GET returns defaults merged with any stored overrides; PUT accepts a
 * partial `{ preferences: {...} }` body validated by
 * `communicationPreferencesUpdateSchema`.
 */

async function resolvePrincipal(request: Request): Promise<string | null> {
  const access = accessTokenFromRequest(request)
  if (access) {
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

function preferencesPayload(principal: string): CommunicationPreferences {
  return getCommunicationPreferences(principal)
}

export async function GET(request: Request) {
  const principal = await resolvePrincipal(request)
  if (!principal) {
    return fail(401, "unauthenticated", "Sign in to view your communication preferences.")
  }
  return ok({ preferences: preferencesPayload(principal) })
}

export async function PUT(request: Request) {
  if (!isSameOriginRequest(request)) {
    return fail(403, "forbidden", "Cross-origin request blocked.")
  }

  const principal = await resolvePrincipal(request)
  if (!principal) {
    return fail(401, "unauthenticated", "Sign in to update your communication preferences.")
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return fail(400, "invalid_request", "Request body must be JSON.")
  }

  const candidate =
    typeof body === "object" && body !== null
      ? (body as { preferences?: unknown }).preferences
      : undefined
  const parsed = communicationPreferencesUpdateSchema.safeParse(candidate ?? {})
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return fail(
      422,
      "invalid_preferences",
      issue?.message ?? "The communication preferences are invalid.",
    )
  }

  updateCommunicationPreferences(principal, parsed.data)
  return ok({ preferences: preferencesPayload(principal) })
}
