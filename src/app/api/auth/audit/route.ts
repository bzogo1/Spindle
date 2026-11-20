import { getAuthBackend } from "@/lib/auth/backend"
import { accessTokenFromRequest, fail, ok } from "@/lib/auth/http"
import { listAuthEvents } from "@/lib/auth/audit"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const MAX_LIMIT = 200
const DEFAULT_LIMIT = 50

/**
 * GET /api/auth/audit?limit=N — returns the signed-in user's own auth audit
 * events, newest first. There is no cross-user admin view yet: workspace roles
 * (owner/admin/member) live at the membership layer and are not carried in the
 * auth session, so every caller sees only events attributed to their userId.
 *
 * Auth: requires a valid `spindle_at` access cookie whose user still exists.
 */
export async function GET(request: Request) {
  const access = accessTokenFromRequest(request)
  if (!access) return fail(401, "unauthorized", "Sign in required.")

  const user = await getAuthBackend().getUserById(access.uid)
  if (!user) return fail(401, "unauthorized", "Sign in required.")

  const rawLimit = new URL(request.url).searchParams.get("limit")
  const parsed = rawLimit === null ? Number.NaN : Number.parseInt(rawLimit, 10)
  const limit = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), MAX_LIMIT) : DEFAULT_LIMIT

  const events = listAuthEvents({ userId: access.uid, limit })
  return ok({ events, limit })
}
