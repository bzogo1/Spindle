import { NextResponse } from "next/server"

import { requireAdmin } from "@/lib/admin-guard"
import {
  AUTH_LIMITS,
  authRateLimited,
  clientIp,
  createAuthRateLimiter,
} from "@/lib/auth-endpoint-rate-limit"
import { fail, ok } from "@/lib/auth/http"
import {
  buildReferralTracking,
  collectAllAttributions,
  REFERRAL_TRACKING_DEFAULT_DAYS,
  REFERRAL_TRACKING_MAX_DAYS,
} from "@/lib/referral-tracking"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * /api/admin/referral-tracking
 *
 * GET — referral tracking analytics over the attribution store:
 *       funnel counts and conversion rates, per-code / per-source
 *       breakdowns, top referrers, and a zero-filled daily series.
 *       Distinct from the sibling endpoints:
 *        - `/api/admin/referral-program` — settings + raw attribution list
 *        - `/api/admin/referral-analytics` — health score, cohorts,
 *          leaderboard, economics
 *        - `/api/admin/referral-fraud` — review queue
 *
 * Query params (optional):
 *   ?days=N — daily-series window, clamped to 1–90
 *             (default {@link REFERRAL_TRACKING_DEFAULT_DAYS}).
 *
 * Admin-only via `requireAdmin`; read-only and rate limited. Computed over
 * the bounded in-memory store described in `src/lib/referral-program.ts`
 * (capped at `REFERRAL_ATTRIBUTIONS_STORE_MAX`, oldest evicted first), so
 * metrics cover only records currently retained on this instance.
 */

const limiter = createAuthRateLimiter(AUTH_LIMITS.publicRead)

function parseDaysParam(value: string | null): number | undefined {
  if (value === null) return undefined
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : undefined
}

export async function GET(request: Request) {
  if (!limiter.check(clientIp(request))) return authRateLimited()

  const admin = await requireAdmin(request)
  if (admin instanceof NextResponse) return admin

  const params = new URL(request.url).searchParams
  const daysParam = params.get("days")
  const days = parseDaysParam(daysParam)
  if (daysParam !== null && days === undefined) {
    return fail(
      400,
      "invalid_request",
      `days must be an integer between 1 and ${REFERRAL_TRACKING_MAX_DAYS}.`,
    )
  }

  try {
    const analytics = buildReferralTracking(collectAllAttributions(), {
      ...(days !== undefined ? { days } : {}),
    })
    return ok(analytics as unknown as Record<string, unknown>)
  } catch {
    return fail(500, "internal", "Could not compute referral tracking analytics.")
  }
}
