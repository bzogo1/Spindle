import { NextResponse } from "next/server"

import { requireAdmin } from "@/lib/admin-guard"
import { adminAuditEventInWindow, parseAdminAuditQuery } from "@/lib/admin-audit"
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
 * GET /api/admin/audit/events?type=&user=&userId=&email=&outcome=&from=&to=
 *   &limit=&offset= — paginated auth audit events across ALL users, newest
 *   first. Admin-only: `requireAdmin` resolves the session and 401/403s
 *   non-admins (same seam as `/api/admin/users`).
 *
 * Filters:
 *  - `type` — exact event type (validated against the audit union),
 *  - `userId` / `email` — exact store-side matches,
 *  - `user` — free-text substring match on email/userId (post-filter),
 *  - `outcome` — `success` | `failure` | `info`, derived from the event type,
 *  - `from` / `to` — inclusive timestamp bounds (date-only values are UTC),
 *  - `limit` (default 50, max 200) / `offset` (max 10000) — pagination.
 *
 * Store limits: the audit log's `list()` returns at most
 * {@link AUDIT_SCAN_LIMIT} newest events and cannot express outcome/date/user
 * substring filters, so this route scans that bounded window and applies the
 * remaining filters itself — `total`/`hasMore` describe the scanned window,
 * exact for the bounded in-memory store (capacity 1000). A durable backend
 * should push the filters down.
 */

const limiter = createAuthRateLimiter(AUTH_LIMITS.publicRead)

/** Matches `MAX_LIST_LIMIT` in the audit store — the most it will return. */
const AUDIT_SCAN_LIMIT = 200

export async function GET(request: Request) {
  if (!limiter.check(clientIp(request))) return authRateLimited()

  const admin = await requireAdmin(request)
  if (admin instanceof NextResponse) return admin

  const parsed = parseAdminAuditQuery(new URL(request.url).searchParams)
  if (!parsed.ok) return fail(400, "invalid_request", parsed.message)

  const { filters, limit, offset } = parsed

  const scanned = listAuthEvents({
    ...(filters.userId ? { userId: filters.userId } : {}),
    ...(filters.email ? { email: filters.email } : {}),
    ...(filters.type ? { type: filters.type } : {}),
    limit: AUDIT_SCAN_LIMIT,
  })

  const inWindow = scanned.filter((event) => adminAuditEventInWindow(event, filters))
  const events = inWindow.slice(offset, offset + limit)

  return ok({
    events,
    limit,
    offset,
    total: inWindow.length,
    hasMore: offset + events.length < inWindow.length,
  })
}
