import { NextResponse } from "next/server"
import { z } from "zod"

import { requireAdmin } from "@/lib/admin-guard"
import {
  AUTH_LIMITS,
  authRateLimited,
  clientIp,
  createAuthRateLimiter,
} from "@/lib/auth-endpoint-rate-limit"
import { fail, isSameOriginRequest, ok } from "@/lib/auth/http"
import {
  PayoutValidationError,
  createPayoutRun,
  listRuns,
  PAYOUT_RUN_STATUSES,
  type PayoutRunStatus,
} from "@/lib/payouts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * /api/admin/payouts
 *
 * GET  — payout runs, newest first. `?status=draft|processing|completed|
 *        failed` filters the list.
 * POST — create a `draft` run: `{ periodStart, periodEnd }` (ISO dates or
 *        datetimes; start must precede end, span ≤ 366 days). Items are added
 *        via `POST /api/admin/payouts/[id]/items` while the run is `draft`,
 *        and processing is simulated via `POST /api/admin/payouts/[id]`.
 *
 * SIMULATED ONLY: `processRun` marks items paid/failed by fixed rules — no
 * money moves, no payment provider is called. See `src/lib/payouts.ts`.
 *
 * Admin-only via `requireAdmin`, same-origin enforced on POST, rate limited.
 */

const limiter = createAuthRateLimiter(AUTH_LIMITS.publicRead)

const postSchema = z.object({
  periodStart: z.string().trim().min(1, "periodStart is required."),
  periodEnd: z.string().trim().min(1, "periodEnd is required."),
})

function isPayoutRunStatus(value: string | null): value is PayoutRunStatus {
  return value !== null && (PAYOUT_RUN_STATUSES as readonly string[]).includes(value)
}

export async function GET(request: Request) {
  if (!limiter.check(clientIp(request))) return authRateLimited()

  const admin = await requireAdmin(request)
  if (admin instanceof NextResponse) return admin

  const statusParam = new URL(request.url).searchParams.get("status")
  const status = isPayoutRunStatus(statusParam) ? statusParam : undefined

  return ok({ runs: listRuns(status) })
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return fail(403, "forbidden", "Cross-origin request blocked.")
  }
  if (!limiter.check(clientIp(request))) return authRateLimited()

  const admin = await requireAdmin(request)
  if (admin instanceof NextResponse) return admin

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return fail(400, "invalid_request", "Request body must be JSON.")
  }

  const parsed = postSchema.safeParse(body)
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "Invalid request."
    return fail(400, "invalid_request", message)
  }

  try {
    const run = createPayoutRun(parsed.data)
    return ok({ run })
  } catch (error) {
    if (error instanceof PayoutValidationError) {
      return fail(400, "invalid_request", error.message)
    }
    throw error
  }
}
