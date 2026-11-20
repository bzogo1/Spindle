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
  EmailScheduleError,
  listScheduled,
  SCHEDULED_EMAIL_STATUSES,
  scheduleEmail,
  type ScheduledEmailStatus,
} from "@/lib/email-scheduler"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * GET  /api/admin/email-schedule?status=&limit=&offset=
 *   — paginated scheduled-email queue, soonest send first. Admin-only.
 * POST /api/admin/email-schedule — enqueue `{ to, subject, sendAt,
 *   textBody?/htmlBody?/templateKey? }`; `sendAt` must be a future ISO
 *   timestamp. Admin-only.
 *
 * Data source: the in-memory dev-seam store in `src/lib/email-scheduler.ts`
 * (per-instance, lost on restart; a `ScheduledEmail` table is the upgrade
 * path). Nothing sends automatically — delivery happens when
 * `processDue()` runs (see `POST /api/admin/email-schedule/tick`; a real
 * scheduler/cron is a documented follow-up).
 */

const readLimiter = createAuthRateLimiter(AUTH_LIMITS.publicRead)
const writeLimiter = createAuthRateLimiter(AUTH_LIMITS.emailSend)

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

function parseNonNegativeInt(raw: string | null, fallback: number): number | null {
  if (raw === null || raw === "") return fallback
  if (!/^\d+$/.test(raw)) return null
  const value = Number.parseInt(raw, 10)
  return Number.isSafeInteger(value) ? value : null
}

export async function GET(request: Request) {
  if (!readLimiter.check(clientIp(request))) return authRateLimited()

  const admin = await requireAdmin(request)
  if (admin instanceof NextResponse) return admin

  const params = new URL(request.url).searchParams

  const statusParam = params.get("status")?.trim() ?? ""
  if (statusParam && !(SCHEDULED_EMAIL_STATUSES as readonly string[]).includes(statusParam)) {
    return fail(400, "invalid_request", "status must be scheduled, sent, failed, or canceled.")
  }

  const limit = parseNonNegativeInt(params.get("limit"), DEFAULT_LIMIT)
  if (limit === null || limit < 1) {
    return fail(400, "invalid_request", "limit must be a positive integer.")
  }
  const offset = parseNonNegativeInt(params.get("offset"), 0)
  if (offset === null) {
    return fail(400, "invalid_request", "offset must be a non-negative integer.")
  }

  const page = listScheduled({
    ...(statusParam ? { status: statusParam as ScheduledEmailStatus } : {}),
    limit: Math.min(limit, MAX_LIMIT),
    offset,
  })

  return ok({
    emails: page.items,
    total: page.total,
    limit: Math.min(limit, MAX_LIMIT),
    offset,
  })
}

export async function POST(request: Request) {
  if (!writeLimiter.check(clientIp(request))) return authRateLimited()

  const admin = await requireAdmin(request)
  if (admin instanceof NextResponse) return admin

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return fail(400, "invalid_request", "Expected a JSON body.")
  }

  try {
    const email = scheduleEmail(body)
    return ok({ email })
  } catch (error) {
    if (error instanceof EmailScheduleError) {
      if (error.code === "queue_full") {
        return fail(409, "queue_full", error.message)
      }
      return fail(400, "invalid_request", error.message)
    }
    throw error
  }
}
