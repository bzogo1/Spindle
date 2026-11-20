import { NextResponse } from "next/server"

import { requireAdmin } from "@/lib/admin-guard"
import {
  AUTH_LIMITS,
  authRateLimited,
  clientIp,
  createAuthRateLimiter,
} from "@/lib/auth-endpoint-rate-limit"
import { fail, ok } from "@/lib/auth/http"
import { getDelivery } from "@/lib/email-delivery"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * GET /api/admin/email-delivery/[emailId] — one delivery record with its
 * full event timeline. Admin-only.
 *
 * Backed by the in-memory dev-seam store in `src/lib/email-delivery.ts`.
 */

const readLimiter = createAuthRateLimiter(AUTH_LIMITS.publicRead)

type RouteContext = { params: Promise<{ emailId: string }> }

export async function GET(request: Request, context: RouteContext) {
  if (!readLimiter.check(clientIp(request))) return authRateLimited()

  const admin = await requireAdmin(request)
  if (admin instanceof NextResponse) return admin

  const { emailId } = await context.params
  const delivery = getDelivery(emailId)
  if (!delivery) return fail(404, "not_found", "Delivery record not found.")
  return ok({ delivery })
}
