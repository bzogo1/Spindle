import { accessTokenFromRequest, fail, ok, readCookie } from "@/lib/auth/http"
import { decodeMockSession, MOCK_SESSION_COOKIE, mockAuthEnabled } from "@/lib/auth/mock-session"
import { getDemoCohortReport } from "@/lib/cohorts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * GET /api/cohorts — signup-week cohort retention report.
 *
 * Auth is required (same session resolution as GET /api/profile: a verified
 * `spindle_at` access cookie, or the `spindle_mock_session` cookie when mock
 * auth is enabled). The report itself is computed from synthetic demo users
 * — see `src/lib/cohorts.ts` for why there is no real data source yet.
 */
function isAuthenticated(request: Request): boolean {
  if (accessTokenFromRequest(request)) return true
  return mockAuthEnabled && decodeMockSession(readCookie(request, MOCK_SESSION_COOKIE)) !== null
}

export async function GET(request: Request) {
  if (!isAuthenticated(request)) {
    return fail(401, "unauthenticated", "Sign in to view cohort analytics.")
  }
  return ok({ report: getDemoCohortReport() })
}
