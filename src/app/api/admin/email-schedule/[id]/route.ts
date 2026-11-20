import { NextResponse } from "next/server"

import { requireAdmin } from "@/lib/admin-guard"
import {
  AUTH_LIMITS,
  authRateLimited,
  clientIp,
  createAuthRateLimiter,
} from "@/lib/auth-endpoint-rate-limit"
import { fail, ok } from "@/lib/auth/http"
import { cancelScheduled, getScheduledEmail } from "@/lib/email-scheduler"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * GET    /api/admin/email-schedule/[id] — one queued/sent/failed/canceled
 *        record. Admin-only.
 * DELETE /api/admin/email-schedule/[id] — cancel a `"scheduled"` record
 *        (409 when it already resolved). Admin-only.
 *
 * Backed by the in-memory dev-seam store in `src/lib/email-scheduler.ts`.
 */

const readLimiter = createAuthRateLimiter(AUTH_LIMITS.publicRead)
const writeLimiter = createAuthRateLimiter(AUTH_LIMITS.emailSend)

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(request: Request, context: RouteContext) {
  if (!readLimiter.check(clientIp(request))) return authRateLimited()

  const admin = await requireAdmin(request)
  if (admin instanceof NextResponse) return admin

  const { id } = await context.params
  const email = getScheduledEmail(id)
  if (!email) return fail(404, "not_found", "Scheduled email not found.")
  return ok({ email })
}

export async function DELETE(request: Request, context: RouteContext) {
  if (!writeLimiter.check(clientIp(request))) return authRateLimited()

  const admin = await requireAdmin(request)
  if (admin instanceof NextResponse) return admin

  const { id } = await context.params
  const result = cancelScheduled(id)
  if (!result.ok) {
    if (result.reason === "not_found") {
      return fail(404, "not_found", "Scheduled email not found.")
    }
    return fail(409, "not_scheduled", "Only scheduled emails can be canceled.")
  }
  return ok({ email: result.email })
}
