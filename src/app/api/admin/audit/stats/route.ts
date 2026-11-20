import { NextResponse } from "next/server"

import {
  adminAuditEventInWindow,
  computeAdminAuditStats,
  parseAdminAuditQuery,
} from "@/lib/admin-audit"
import { requireAdmin } from "@/lib/admin-guard"
import { listAuthEvents } from "@/lib/auth/audit"
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
 * GET /api/admin/audit/stats?type=&user=&userId=&email=&outcome=&from=&to=
 *   — aggregate stats over the auth audit log for the admin dashboard:
 *   total/success/failure counts, failure rate, counts by event type and by
 *   UTC day, and the most active users. Admin-only via `requireAdmin`.
 *
 * Accepts the same filters as `/api/admin/audit/events` (minus pagination)
 * and aggregates the same bounded scan window — `scanned` reports how many
 * events the store returned before post-filtering so the UI can caveat the
 * numbers when the window is saturated. See the events route for details.
 */

const limiter = createAuthRateLimiter(AUTH_LIMITS.publicRead)

const AUDIT_SCAN_LIMIT = 200

export async function GET(request: Request) {
  if (!limiter.check(clientIp(request))) return authRateLimited()

  const admin = await requireAdmin(request)
  if (admin instanceof NextResponse) return admin

  const parsed = parseAdminAuditQuery(new URL(request.url).searchParams)
  if (!parsed.ok) return fail(400, "invalid_request", parsed.message)

  const { filters } = parsed

  const scanned = listAuthEvents({
    ...(filters.userId ? { userId: filters.userId } : {}),
    ...(filters.email ? { email: filters.email } : {}),
    ...(filters.type ? { type: filters.type } : {}),
    limit: AUDIT_SCAN_LIMIT,
  })

  const inWindow = scanned.filter((event) => adminAuditEventInWindow(event, filters))

  return ok({
    stats: computeAdminAuditStats(inWindow),
    scanned: scanned.length,
  })
}
