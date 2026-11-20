import { NextResponse } from "next/server"
import { z } from "zod"

import { requireAdmin } from "@/lib/admin-guard"
import {
  AFFILIATE_STATUSES,
  AffiliateTransitionError,
  approveAffiliate,
  listAffiliates,
  rejectAffiliate,
  statsForAffiliate,
  suspendAffiliate,
  type AffiliateStatus,
} from "@/lib/affiliate"
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
 * /api/admin/affiliates
 *
 * GET  — every affiliate application, newest first, each enriched with its
 *        click/conversion stats. `?status=pending|active|suspended|rejected`
 *        filters to one status (the approval queue is `?status=pending`).
 * PATCH — transition one account: `{ id, action: "approve" | "reject" |
 *        "suspend" }`. The status machine lives in `src/lib/affiliate.ts`
 *        (`AFFILIATE_TRANSITIONS`): approve works from pending|suspended,
 *        reject from pending|suspended, suspend from active only — anything
 *        else is a 409, unknown ids 404.
 *
 * Admin-only via `requireAdmin`, same-origin enforced on PATCH, both rate
 * limited. The store is the in-memory dev seam in `src/lib/affiliate.ts` —
 * approval gates whether a code records clicks/conversions; there are no
 * real payouts.
 */

const limiter = createAuthRateLimiter(AUTH_LIMITS.publicRead)

const patchSchema = z.object({
  id: z.string().trim().min(1, "id is required."),
  action: z.enum(["approve", "reject", "suspend"]),
})

function isAffiliateStatus(value: string | null): value is AffiliateStatus {
  return value !== null && (AFFILIATE_STATUSES as readonly string[]).includes(value)
}

export async function GET(request: Request) {
  if (!limiter.check(clientIp(request))) return authRateLimited()

  const admin = await requireAdmin(request)
  if (admin instanceof NextResponse) return admin

  const statusParam = new URL(request.url).searchParams.get("status")
  const status = isAffiliateStatus(statusParam) ? statusParam : undefined
  const affiliates = listAffiliates(status).map((account) => ({
    ...account,
    stats: statsForAffiliate(account),
  }))
  return ok({ affiliates })
}

export async function PATCH(request: Request) {
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

  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "Invalid request."
    return fail(400, "invalid_request", message)
  }

  const { id, action } = parsed.data
  let account
  try {
    account =
      action === "approve"
        ? approveAffiliate(id)
        : action === "reject"
          ? rejectAffiliate(id)
          : suspendAffiliate(id)
  } catch (error) {
    if (error instanceof AffiliateTransitionError) {
      return fail(409, "invalid_transition", error.message)
    }
    throw error
  }

  if (!account) {
    return fail(404, "not_found", "Affiliate account not found.")
  }
  return ok({ affiliate: { ...account, stats: statsForAffiliate(account) } })
}
