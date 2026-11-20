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
  EMAIL_DELIVERY_EVENT_TYPES,
  listDeliveries,
  stats,
  type EmailDeliveryStatus,
} from "@/lib/email-delivery"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * GET /api/admin/email-delivery?status=&to=&limit=&offset=
 *   — paginated delivery-lifecycle records (most recently active first)
 *     plus global `stats` (status counts and event-based rate
 *     approximations). Admin-only.
 *
 * Data source: the in-memory dev-seam store in `src/lib/email-delivery.ts`
 * (per-instance, lost on restart). Nothing populates it automatically yet —
 * send paths wire in via `trackEmailSend`/`recordEvent` (see that module's
 * docstring); provider webhooks are a follow-up.
 */

const readLimiter = createAuthRateLimiter(AUTH_LIMITS.publicRead)

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
  if (statusParam && !(EMAIL_DELIVERY_EVENT_TYPES as readonly string[]).includes(statusParam)) {
    return fail(
      400,
      "invalid_request",
      `status must be one of: ${EMAIL_DELIVERY_EVENT_TYPES.join(", ")}.`,
    )
  }

  const toParam = params.get("to")?.trim() ?? ""
  if (toParam.length > 320) {
    return fail(400, "invalid_request", "to filter is too long.")
  }

  const limit = parseNonNegativeInt(params.get("limit"), DEFAULT_LIMIT)
  if (limit === null || limit < 1) {
    return fail(400, "invalid_request", "limit must be a positive integer.")
  }
  const offset = parseNonNegativeInt(params.get("offset"), 0)
  if (offset === null) {
    return fail(400, "invalid_request", "offset must be a non-negative integer.")
  }

  const page = listDeliveries({
    ...(statusParam ? { status: statusParam as EmailDeliveryStatus } : {}),
    ...(toParam ? { to: toParam } : {}),
    limit: Math.min(limit, MAX_LIMIT),
    offset,
  })

  return ok({
    deliveries: page.items,
    total: page.total,
    stats: stats(),
    limit: Math.min(limit, MAX_LIMIT),
    offset,
  })
}
