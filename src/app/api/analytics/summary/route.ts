import { fail, ok } from "@/lib/auth/http"
import { getAnalyticsSummary } from "@/lib/analytics"
import { notificationPrincipalFromRequest } from "@/lib/notifications/principal"
import { createRateLimiter } from "@/lib/site-forms"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * GET /api/analytics/summary?days=7|30 — aggregates for the dashboard
 * analytics card.
 *
 * Auth-required: resolves the caller's session principal the same way the
 * notifications stream does (real `spindle_at` cookie or mock session) and
 * returns only events attributed to that principal — page views, feature
 * uses, and API calls recorded while signed in. Anonymous marketing-site
 * hits are stored but never exposed here.
 *
 * Response: `{ ok: true, summary: AnalyticsSummary }` with totals, a per-day
 * UTC series, and top events/paths (see `getAnalyticsSummary`).
 */

const summaryLimiter = createRateLimiter({ limit: 60, windowMs: 60_000 })

const DEFAULT_DAYS = 30
const MAX_DAYS = 90

export async function GET(request: Request) {
  const principal = notificationPrincipalFromRequest(request)
  if (!principal) {
    return fail(401, "unauthenticated", "Sign in to view analytics.")
  }

  if (!summaryLimiter.check(`summary:${principal}`)) {
    return fail(429, "rate_limited", "Too many requests. Try again later.")
  }

  const daysParam = new URL(request.url).searchParams.get("days")
  let days = DEFAULT_DAYS
  if (daysParam !== null) {
    const parsed = Number(daysParam)
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_DAYS) {
      return fail(400, "invalid_days", `days must be an integer between 1 and ${MAX_DAYS}.`)
    }
    days = parsed
  }

  const summary = getAnalyticsSummary({ days, userId: principal })
  return ok({ summary })
}
