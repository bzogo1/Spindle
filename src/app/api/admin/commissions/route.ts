import { NextResponse } from "next/server"
import { z } from "zod"

import { requireAdmin } from "@/lib/admin-guard"
import { listAffiliates } from "@/lib/affiliate"
import {
  COMMISSION_STATUSES,
  recordCommission,
  listCommissions,
  type CommissionStatus,
} from "@/lib/commissions"
import {
  AUTH_LIMITS,
  authRateLimited,
  clientIp,
  createAuthRateLimiter,
} from "@/lib/auth-endpoint-rate-limit"
import { fail, isSameOriginRequest, ok } from "@/lib/auth/http"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * /api/admin/commissions
 *
 * GET  — the commission ledger, newest first. `?affiliateId=aff_…` and
 *        `?status=pending|approved|paid|void` filter the list.
 * POST — record a commission manually: `{ affiliateId, conversionId?,
 *        amountCents, reason? }`. `affiliateId` must reference an existing
 *        affiliate account. New records start `pending`; transitions happen
 *        via `PATCH /api/admin/commissions/[id]`.
 *
 * REPORTING ONLY: `paid` is a ledger status — no money moves (payout
 * automation is a separate task). Conversion → commission auto-wiring is a
 * future hook; nothing calls this automatically today.
 *
 * Admin-only via `requireAdmin`, same-origin enforced on POST, both rate
 * limited. The store is the in-memory dev seam in `src/lib/commissions.ts`.
 */

const limiter = createAuthRateLimiter(AUTH_LIMITS.publicRead)

const postSchema = z.object({
  affiliateId: z.string().trim().min(1, "affiliateId is required."),
  conversionId: z.string().trim().min(1).optional(),
  amountCents: z
    .number()
    .int("amountCents must be an integer.")
    .nonnegative("amountCents must be non-negative."),
  reason: z.string().trim().max(500).optional(),
})

function isCommissionStatus(value: string | null): value is CommissionStatus {
  return value !== null && (COMMISSION_STATUSES as readonly string[]).includes(value)
}

export async function GET(request: Request) {
  if (!limiter.check(clientIp(request))) return authRateLimited()

  const admin = await requireAdmin(request)
  if (admin instanceof NextResponse) return admin

  const params = new URL(request.url).searchParams
  const statusParam = params.get("status")
  const status = isCommissionStatus(statusParam) ? statusParam : undefined
  const affiliateId = params.get("affiliateId")?.trim() || undefined

  return ok({ commissions: listCommissions({ affiliateId, status }) })
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return fail(403, "forbidden", "Cross-origin request blocked.")
  }
  if (!limiter.check(clientIp(request))) return authRateLimited()

  const admin = await requireAdmin(request)
  if (admin instanceof NextResponse) return admin

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return fail(400, "invalid_request", "Request body must be JSON.")
  }

  const parsed = postSchema.safeParse(body)
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "Invalid request."
    return fail(400, "invalid_request", message)
  }

  const { affiliateId, conversionId, amountCents, reason } = parsed.data

  // The affiliate store has no get-by-id; it is bounded (500 accounts), so a
  // linear scan is cheap and keeps commissions.ts decoupled from affiliate.ts.
  const affiliateExists = listAffiliates().some((account) => account.id === affiliateId)
  if (!affiliateExists) {
    return fail(400, "invalid_request", "affiliateId does not match an affiliate account.")
  }

  try {
    const commission = recordCommission({ affiliateId, conversionId, amountCents, reason })
    return ok({ commission })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not record the commission."
    return fail(400, "invalid_request", message)
  }
}
