import { NextResponse } from "next/server"
import { z } from "zod"

import { requireAdmin } from "@/lib/admin-guard"
import {
  AUTH_LIMITS,
  authRateLimited,
  clientIp,
  createAuthRateLimiter,
} from "@/lib/auth-endpoint-rate-limit"
import { fail, ok } from "@/lib/auth/http"
import {
  createCampaign,
  defaultWinBackUserSource,
  findInactiveUsers,
  getCampaign,
  isWinBackStatus,
  listCampaigns,
  WIN_BACK_MAX_MIN_INACTIVE_DAYS,
  WIN_BACK_MIN_INACTIVE_DAYS,
  WIN_BACK_STATUSES,
  WinBackError,
} from "@/lib/win-back"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * /api/admin/win-back
 *
 * GET  — list win-back campaigns, newest first. Optional `?status=` filter
 *        (draft|active|paused|completed). With `?preview=1&campaignId=<id>`
 *        returns `{ candidateCount }` — how many inactive users the campaign
 *        would reach right now (pre opt-out filtering).
 * POST — create a draft campaign `{ name, subject, body, minInactiveDays,
 *        targetSegment? }`.
 *
 * Admin-only via `requireAdmin`. Sends are NOT triggered here — an admin runs
 * a campaign explicitly via POST /api/admin/win-back/[id] (see [id]/route.ts).
 * The store is the in-memory dev seam described in `src/lib/win-back.ts`.
 */

const limiter = createAuthRateLimiter(AUTH_LIMITS.publicRead)

const createSchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(120, "Name is too long."),
  subject: z.string().trim().min(1, "Subject is required.").max(200, "Subject is too long."),
  body: z.string().trim().min(1, "Body is required.").max(50_000, "Body is too long."),
  minInactiveDays: z
    .number()
    .int()
    .min(WIN_BACK_MIN_INACTIVE_DAYS)
    .max(WIN_BACK_MAX_MIN_INACTIVE_DAYS),
  targetSegment: z.string().trim().min(1).max(120).optional(),
})

export async function GET(request: Request) {
  if (!limiter.check(clientIp(request))) return authRateLimited()

  const admin = await requireAdmin(request)
  if (admin instanceof NextResponse) return admin

  const params = new URL(request.url).searchParams

  if (params.get("preview") === "1" || params.get("preview") === "true") {
    const campaignId = params.get("campaignId")?.trim()
    if (!campaignId) {
      return fail(400, "invalid_request", "preview requires campaignId.")
    }
    const campaign = getCampaign(campaignId)
    if (!campaign) return fail(404, "not_found", "Campaign not found.")
    try {
      const candidates = await findInactiveUsers(campaign.minInactiveDays, defaultWinBackUserSource)
      return ok({ candidateCount: candidates.length, campaignId: campaign.id })
    } catch {
      return fail(500, "internal", "Could not compute candidates.")
    }
  }

  const statusParam = params.get("status")?.trim() ?? ""
  if (statusParam && !isWinBackStatus(statusParam)) {
    return fail(400, "invalid_request", `status must be one of: ${WIN_BACK_STATUSES.join(", ")}.`)
  }

  const limitParam = params.get("limit")
  const offsetParam = params.get("offset")
  const limit = limitParam ? Number.parseInt(limitParam, 10) : undefined
  const offset = offsetParam ? Number.parseInt(offsetParam, 10) : undefined
  if ((limitParam && !Number.isFinite(limit)) || (offsetParam && !Number.isFinite(offset))) {
    return fail(400, "invalid_request", "limit and offset must be integers.")
  }

  const result = listCampaigns({
    ...(statusParam ? { status: statusParam as (typeof WIN_BACK_STATUSES)[number] } : {}),
    ...(limit !== undefined ? { limit: Math.min(Math.max(limit, 0), 500) } : {}),
    ...(offset !== undefined ? { offset: Math.max(offset, 0) } : {}),
  })
  return ok({ campaigns: result.items, total: result.total })
}

export async function POST(request: Request) {
  if (!limiter.check(clientIp(request))) return authRateLimited()

  const admin = await requireAdmin(request)
  if (admin instanceof NextResponse) return admin

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return fail(400, "invalid_request", "Invalid request.")
  }

  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "Invalid campaign."
    return fail(400, "invalid_request", message)
  }

  try {
    const campaign = createCampaign({
      name: parsed.data.name,
      subject: parsed.data.subject,
      bodyTemplate: parsed.data.body,
      minInactiveDays: parsed.data.minInactiveDays,
      ...(parsed.data.targetSegment ? { targetSegment: parsed.data.targetSegment } : {}),
    })
    return ok({ campaign })
  } catch (error) {
    if (error instanceof WinBackError) {
      return fail(400, "invalid_request", error.message)
    }
    return fail(400, "invalid_request", "Invalid campaign.")
  }
}
