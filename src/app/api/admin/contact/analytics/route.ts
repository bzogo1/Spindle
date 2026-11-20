import { NextResponse } from "next/server"

import { requireAdmin } from "@/lib/admin-guard"
import {
  buildContactAnalytics,
  CONTACT_ANALYTICS_DEFAULT_DAYS,
  CONTACT_ANALYTICS_MAX_DAYS,
} from "@/lib/contact-analytics"
import { CONTACT_STORE_MAX_SUBMISSIONS, listSubmissions } from "@/lib/contact-routing"
import {
  AUTH_LIMITS,
  authRateLimited,
  clientIp,
  createAuthRateLimiter,
} from "@/lib/auth-endpoint-rate-limit"
import { fail, ok } from "@/lib/auth/http"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * GET /api/admin/contact/analytics?days=
 *   — aggregate analytics over the contact-submission store: totals, status /
 *   queue / topic breakdowns, per-queue shares, and daily volume.
 *
 * Admin-only via `requireAdmin` (401 unauthenticated / 403 non-admin), same
 * rate-limit preset as the inbox list endpoint.
 *
 * `days` selects the daily-series window: integer 1–90, default 30. Invalid
 * values return 400.
 *
 * DATA CAVEAT: the store in `src/lib/contact-routing.ts` is in-memory,
 * per-instance, bounded at CONTACT_STORE_MAX_SUBMISSIONS (oldest evicted
 * first), and lost on restart. These analytics therefore cover only the
 * submissions currently retained on this instance — they are not historical
 * totals. The aggregation itself is pure (`buildContactAnalytics`); when the
 * store moves to a database this endpoint keeps its shape and the window
 * semantics carry over.
 */

const limiter = createAuthRateLimiter(AUTH_LIMITS.publicRead)

function parseDays(raw: string | null): number | null {
  if (raw === null || raw === "") return CONTACT_ANALYTICS_DEFAULT_DAYS
  if (!/^\d+$/.test(raw)) return null
  const value = Number.parseInt(raw, 10)
  if (!Number.isSafeInteger(value)) return null
  if (value < 1 || value > CONTACT_ANALYTICS_MAX_DAYS) return null
  return value
}

export async function GET(request: Request) {
  if (!limiter.check(clientIp(request))) return authRateLimited()

  const admin = await requireAdmin(request)
  if (admin instanceof NextResponse) return admin

  const days = parseDays(new URL(request.url).searchParams.get("days"))
  if (days === null) {
    return fail(
      400,
      "invalid_request",
      `days must be an integer between 1 and ${CONTACT_ANALYTICS_MAX_DAYS}.`,
    )
  }

  // The store is bounded (CONTACT_STORE_MAX_SUBMISSIONS), so fetching "all"
  // submissions is cheap and keeps aggregation purely server-side.
  const { items } = listSubmissions({ limit: CONTACT_STORE_MAX_SUBMISSIONS })
  const analytics = buildContactAnalytics(items, { days })

  return ok({
    summary: analytics.summary,
    queueBreakdown: analytics.queueBreakdown,
    daily: analytics.daily,
    days: analytics.days,
    generatedAt: analytics.generatedAt,
  })
}
