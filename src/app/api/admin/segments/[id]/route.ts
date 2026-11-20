import { NextResponse } from "next/server"

import { requireAdmin } from "@/lib/admin-guard"
import {
  AUTH_LIMITS,
  authRateLimited,
  clientIp,
  createAuthRateLimiter,
} from "@/lib/auth-endpoint-rate-limit"
import { fail, isSameOriginRequest, ok } from "@/lib/auth/http"
import {
  deleteSegment,
  evaluateSegment,
  getSegment,
  listBackendSegmentUsers,
  SEGMENT_SAMPLE_SIZE,
} from "@/lib/segments"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * GET    /api/admin/segments/[id] — one segment plus its live match stats:
 *         `matchCount`, up to SEGMENT_SAMPLE_SIZE matched emails, and how
 *         many backend users were scanned (`evaluatedUsers`).
 * DELETE /api/admin/segments/[id] — remove the segment. Admin-only.
 *
 * Evaluation runs against the in-memory auth backend's user/session stores
 * via `listBackendSegmentUsers` (bounded by SEGMENT_EVALUATION_MAX_USERS);
 * see `src/lib/segments.ts` for the dev-seam notes.
 */

const readLimiter = createAuthRateLimiter(AUTH_LIMITS.publicRead)
const writeLimiter = createAuthRateLimiter(AUTH_LIMITS.emailSend)

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(request: Request, context: RouteContext) {
  if (!readLimiter.check(clientIp(request))) return authRateLimited()

  const admin = await requireAdmin(request)
  if (admin instanceof NextResponse) return admin

  const { id } = await context.params
  const segment = getSegment(id)
  if (!segment) return fail(404, "not_found", "Segment not found.")

  const users = listBackendSegmentUsers()
  const matched = evaluateSegment(segment, users)
  return ok({
    segment,
    matchCount: matched.length,
    sample: matched.slice(0, SEGMENT_SAMPLE_SIZE).map((user) => user.email),
    evaluatedUsers: users.length,
  })
}

export async function DELETE(request: Request, context: RouteContext) {
  if (!isSameOriginRequest(request)) {
    return fail(403, "forbidden", "Cross-origin request blocked.")
  }
  if (!writeLimiter.check(clientIp(request))) return authRateLimited()

  const admin = await requireAdmin(request)
  if (admin instanceof NextResponse) return admin

  const { id } = await context.params
  if (!deleteSegment(id)) {
    return fail(404, "not_found", "Segment not found.")
  }
  return ok({ deleted: true })
}
