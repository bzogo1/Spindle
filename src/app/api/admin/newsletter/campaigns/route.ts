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
import { listCampaigns, recordCampaign } from "@/lib/newsletter-store"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * /api/admin/newsletter/campaigns
 *
 * GET  — paginated campaign list from the newsletter store (`limit`,
 *        `offset`; defaults 50 / max 200).
 * POST — create a draft campaign `{ subject, body? }`. Only a truncated
 *        `bodyPreview` is persisted.
 *
 * Admin-only via `requireAdmin`. NOTE: campaign *delivery* is a later task —
 * this endpoint only records drafts; nothing is sent to subscribers here.
 * The store is the in-memory dev seam described in
 * `src/lib/newsletter-store.ts`.
 */

const limiter = createAuthRateLimiter(AUTH_LIMITS.publicRead)

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

const campaignSchema = z.object({
  subject: z.string().trim().min(1, "Subject is required.").max(200, "Subject is too long."),
  body: z.string().max(50_000, "Body is too long.").optional(),
})

function parseLimit(raw: string | null): number | null {
  if (raw === null || raw === "") return DEFAULT_LIMIT
  if (!/^\d+$/.test(raw)) return null
  const value = Number.parseInt(raw, 10)
  return Number.isSafeInteger(value) && value >= 1 ? Math.min(value, MAX_LIMIT) : null
}

function parseOffset(raw: string | null): number | null {
  if (raw === null || raw === "") return 0
  if (!/^\d+$/.test(raw)) return null
  const value = Number.parseInt(raw, 10)
  return Number.isSafeInteger(value) ? value : null
}

export async function GET(request: Request) {
  if (!limiter.check(clientIp(request))) return authRateLimited()

  const admin = await requireAdmin(request)
  if (admin instanceof NextResponse) return admin

  const params = new URL(request.url).searchParams
  const limit = parseLimit(params.get("limit"))
  const offset = parseOffset(params.get("offset"))
  if (limit === null || offset === null) {
    return fail(400, "invalid_request", "limit must be a positive integer and offset non-negative.")
  }

  const page = listCampaigns({ limit, offset })
  return ok({ campaigns: page.items, total: page.total, limit, offset })
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

  const parsed = campaignSchema.safeParse(body)
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "Invalid campaign."
    return fail(400, "invalid_request", message)
  }

  const campaign = recordCampaign({
    subject: parsed.data.subject,
    ...(parsed.data.body !== undefined ? { body: parsed.data.body } : {}),
  })

  return ok({ campaign })
}
