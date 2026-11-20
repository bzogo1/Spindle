import { NextResponse } from "next/server"

import { requireAdmin } from "@/lib/admin-guard"
import {
  AUTH_LIMITS,
  authRateLimited,
  clientIp,
  createAuthRateLimiter,
} from "@/lib/auth-endpoint-rate-limit"
import { ok } from "@/lib/auth/http"
import { processDue } from "@/lib/email-scheduler"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * POST /api/admin/email-schedule/tick — runs `processDue()` once: attempts
 * delivery for every scheduled email whose `sendAt` has passed and returns
 * `{ processed, sent, failed }`.
 *
 * This is the scheduler seam. No cron/worker exists in this codebase — a real
 * scheduler (cron job, Vercel cron, worker) calling `processDue()` is a
 * documented follow-up. Until then this admin-only endpoint (and the "Run
 * due now" button on `/app/admin/email-schedule`) simulates a tick.
 */

const limiter = createAuthRateLimiter(AUTH_LIMITS.emailSend)

export async function POST(request: Request) {
  if (!limiter.check(clientIp(request))) return authRateLimited()

  const admin = await requireAdmin(request)
  if (admin instanceof NextResponse) return admin

  const summary = await processDue()
  return ok({ ...summary })
}
