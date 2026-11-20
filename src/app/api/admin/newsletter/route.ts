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
  listSubscribers,
  NEWSLETTER_SUBSCRIBER_STATUSES,
  stats,
  type NewsletterSubscriberStatus,
} from "@/lib/newsletter-store"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * GET /api/admin/newsletter?status=&q=&limit=&offset=
 *   — newsletter management for admins: store-wide stats plus a paginated,
 *   filterable subscriber list. Admin-only via `requireAdmin`.
 *
 * Data source: the in-memory dev-seam store in `src/lib/newsletter-store.ts`
 * (see its docstring — per-instance, lost on restart; the upgrade path is a
 * `NewsletterSubscriber` table). Subscribers see full emails here; this
 * endpoint is admin-only.
 *
 * `status` filters to pending|active|unsubscribed; `q` is a case-insensitive
 * substring match on email and source; `limit` defaults to 50 (max 200) and
 * `offset` paginates the filtered set.
 */

const limiter = createAuthRateLimiter(AUTH_LIMITS.publicRead)

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200
const MAX_QUERY_LENGTH = 200

function parseNonNegativeInt(raw: string | null, fallback: number): number | null {
  if (raw === null || raw === "") return fallback
  if (!/^\d+$/.test(raw)) return null
  const value = Number.parseInt(raw, 10)
  return Number.isSafeInteger(value) ? value : null
}

export async function GET(request: Request) {
  if (!limiter.check(clientIp(request))) return authRateLimited()

  const admin = await requireAdmin(request)
  if (admin instanceof NextResponse) return admin

  const params = new URL(request.url).searchParams

  const statusParam = params.get("status")?.trim() ?? ""
  if (statusParam && !(NEWSLETTER_SUBSCRIBER_STATUSES as readonly string[]).includes(statusParam)) {
    return fail(400, "invalid_request", "status must be pending, active, or unsubscribed.")
  }

  const q = params.get("q")?.trim() ?? ""
  if (q.length > MAX_QUERY_LENGTH) {
    return fail(400, "invalid_request", "Search query is too long.")
  }

  const limit = parseNonNegativeInt(params.get("limit"), DEFAULT_LIMIT)
  if (limit === null || limit < 1) {
    return fail(400, "invalid_request", "limit must be a positive integer.")
  }
  const offset = parseNonNegativeInt(params.get("offset"), 0)
  if (offset === null) {
    return fail(400, "invalid_request", "offset must be a non-negative integer.")
  }

  const page = listSubscribers({
    ...(statusParam ? { status: statusParam as NewsletterSubscriberStatus } : {}),
    ...(q ? { query: q } : {}),
    limit: Math.min(limit, MAX_LIMIT),
    offset,
  })

  return ok({
    stats: stats(),
    subscribers: page.items,
    total: page.total,
    limit: Math.min(limit, MAX_LIMIT),
    offset,
  })
}
