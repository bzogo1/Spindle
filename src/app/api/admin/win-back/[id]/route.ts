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
  getCampaign,
  isWinBackStatus,
  updateCampaign,
  WIN_BACK_MAX_MIN_INACTIVE_DAYS,
  WIN_BACK_MIN_INACTIVE_DAYS,
  WIN_BACK_STATUSES,
  WinBackError,
} from "@/lib/win-back"
import { runWinBackCampaign } from "./handler"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * /api/admin/win-back/[id]
 *
 * GET   — one campaign.
 * PATCH — `{ status?, name?, subject?, body?, minInactiveDays?, targetSegment? }`.
 *         `status` must be one of draft|active|paused|completed; completed
 *         campaigns are immutable.
 * POST  — runs the campaign NOW: `runCampaign` emails every inactive,
 *         non-opted-out candidate via `sendEmail`. This is the ONLY trigger —
 *         there is no scheduler/cron; each run is an explicit admin action.
 *
 * Admin-only via `requireAdmin`. Delivery goes through the Resend seam in
 * `src/lib/email.ts`: without RESEND_API_KEY sends resolve "unconfigured"
 * and are counted as `failed`, never silently "sent".
 */

const limiter = createAuthRateLimiter(AUTH_LIMITS.publicRead)

const patchSchema = z
  .object({
    status: z.string().optional(),
    name: z.string().trim().min(1).max(120).optional(),
    subject: z.string().trim().min(1).max(200).optional(),
    body: z.string().trim().min(1).max(50_000).optional(),
    minInactiveDays: z
      .number()
      .int()
      .min(WIN_BACK_MIN_INACTIVE_DAYS)
      .max(WIN_BACK_MAX_MIN_INACTIVE_DAYS)
      .optional(),
    targetSegment: z.string().trim().min(1).max(120).nullable().optional(),
  })
  .refine(
    (value) =>
      value.status !== undefined ||
      value.name !== undefined ||
      value.subject !== undefined ||
      value.body !== undefined ||
      value.minInactiveDays !== undefined ||
      value.targetSegment !== undefined,
    { message: "Provide at least one field to update." },
  )

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(request: Request, context: RouteContext) {
  if (!limiter.check(clientIp(request))) return authRateLimited()

  const admin = await requireAdmin(request)
  if (admin instanceof NextResponse) return admin

  const { id } = await context.params
  const campaign = getCampaign(id)
  if (!campaign) return fail(404, "not_found", "Campaign not found.")
  return ok({ campaign })
}

export async function PATCH(request: Request, context: RouteContext) {
  if (!limiter.check(clientIp(request))) return authRateLimited()

  const admin = await requireAdmin(request)
  if (admin instanceof NextResponse) return admin

  const { id } = await context.params

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return fail(400, "invalid_request", "Expected a JSON body.")
  }

  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "Invalid request."
    return fail(400, "invalid_request", message)
  }

  const { status, body: bodyTemplate, ...rest } = parsed.data
  if (status !== undefined && !isWinBackStatus(status)) {
    return fail(400, "invalid_request", `status must be one of: ${WIN_BACK_STATUSES.join(", ")}.`)
  }

  try {
    const campaign = updateCampaign(id, {
      ...rest,
      ...(status !== undefined ? { status: status as (typeof WIN_BACK_STATUSES)[number] } : {}),
      ...(bodyTemplate !== undefined ? { bodyTemplate } : {}),
    })
    return ok({ campaign })
  } catch (error) {
    if (error instanceof WinBackError) {
      const code = error.code === "not_found" ? 404 : 400
      return fail(code, error.code === "not_found" ? "not_found" : "invalid_request", error.message)
    }
    return fail(500, "internal", "Could not update the campaign.")
  }
}

export async function POST(request: Request, context: RouteContext) {
  if (!limiter.check(clientIp(request))) return authRateLimited()

  const admin = await requireAdmin(request)
  if (admin instanceof NextResponse) return admin

  const { id } = await context.params
  return runWinBackCampaign(id, request)
}
