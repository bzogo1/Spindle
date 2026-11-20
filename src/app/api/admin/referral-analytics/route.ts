import { NextResponse } from "next/server"
import { z } from "zod"

import { requireAdmin } from "@/lib/admin-guard"
import {
  AUTH_LIMITS,
  authRateLimited,
  clientIp,
  createAuthRateLimiter,
} from "@/lib/auth-endpoint-rate-limit"
import { fail, ok } from "@/lib/auth/http"
import { getReferralAnalytics } from "@/lib/referral-analytics"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * /api/admin/referral-analytics
 *
 * GET — program-level referral analytics: health score, signup cohorts,
 *       referrer leaderboard, reward-economics estimates, and fraud
 *       exposure. Distinct from `/api/admin/referral-program` (settings +
 *       raw attribution list) and `/api/admin/referral-fraud` (review
 *       queue): this endpoint aggregates, it does not list records.
 *
 * Query params (all optional):
 *   ?period=7d|30d|90d|all  — attribution window (default: all)
 *   ?granularity=week|month — cohort bucket size (default: month)
 *
 * Admin-only via `requireAdmin`; read-only and rate limited. Computed over
 * the bounded in-memory attribution store described in
 * `src/lib/referral-program.ts` — numbers cover only records currently
 * retained on this instance.
 */

const limiter = createAuthRateLimiter(AUTH_LIMITS.publicRead)

const querySchema = z.object({
  period: z.enum(["7d", "30d", "90d", "all"]).optional(),
  granularity: z.enum(["week", "month"]).optional(),
})

const PERIOD_DAYS: Record<string, number | null> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
  all: null,
}

export async function GET(request: Request) {
  if (!limiter.check(clientIp(request))) return authRateLimited()

  const admin = await requireAdmin(request)
  if (admin instanceof NextResponse) return admin

  const params = new URL(request.url).searchParams
  const parsed = querySchema.safeParse({
    period: params.get("period") ?? undefined,
    granularity: params.get("granularity") ?? undefined,
  })
  if (!parsed.success) {
    return fail(
      400,
      "invalid_request",
      "period must be one of: 7d, 30d, 90d, all. granularity must be week or month.",
    )
  }

  try {
    const report = getReferralAnalytics({
      periodDays: parsed.data.period ? PERIOD_DAYS[parsed.data.period] : null,
      cohortGranularity: parsed.data.granularity,
    })
    return ok(report as unknown as Record<string, unknown>)
  } catch {
    return fail(500, "internal", "Could not compute referral analytics.")
  }
}
