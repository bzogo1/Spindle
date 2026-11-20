import { NextResponse } from "next/server"

import { requireAdmin } from "@/lib/admin-guard"
import {
  AUTH_LIMITS,
  authRateLimited,
  clientIp,
  createAuthRateLimiter,
} from "@/lib/auth-endpoint-rate-limit"
import { runWinBackCampaign } from "../handler"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * POST /api/admin/win-back/[id]/run — explicit admin-triggered campaign run.
 *
 * Thin alias for `POST /api/admin/win-back/[id]`; both call `runCampaign`
 * in `src/lib/win-back.ts` via `./handler`. There is no scheduler — every
 * run is a manual admin action.
 */

const limiter = createAuthRateLimiter(AUTH_LIMITS.publicRead)

type RouteContext = { params: Promise<{ id: string }> }

export async function POST(request: Request, context: RouteContext) {
  if (!limiter.check(clientIp(request))) return authRateLimited()

  const admin = await requireAdmin(request)
  if (admin instanceof NextResponse) return admin

  const { id } = await context.params
  return runWinBackCampaign(id, request)
}
