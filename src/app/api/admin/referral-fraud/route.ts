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
  addReferralRecord,
  flagJson,
  isReferralFraudFlagStatus,
  listFlags,
  REFERRAL_FRAUD_FLAG_STATUSES,
  scanReferrals,
  type ReferralRecord,
} from "@/lib/referral-fraud"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * /api/admin/referral-fraud
 *
 * GET  — the flagged-referral review queue, highest score first. Optional
 *        `?status=` filter (pending|cleared|confirmed_fraud), `?limit=` /
 *        `?offset=` pagination.
 * POST — run the fraud rules. With no body (or `{}`) scans the process-local
 *        referral-record store (`scanReferrals`); with `{ records: [...] }`
 *        scans an explicit record list and stores it in the dev-seam store
 *        first, so ad-hoc scans become reviewable flags.
 *
 * Admin-only via `requireAdmin`. There is no referral backend yet — records
 * and flags live in the in-memory dev seam described in
 * `src/lib/referral-fraud.ts` (same interim-store pattern as win-back).
 */

const limiter = createAuthRateLimiter(AUTH_LIMITS.publicRead)

const optionalString = z.string().trim().min(1).max(500).optional()

const referralRecordSchema = z.object({
  id: z.string().trim().min(1).max(120),
  referrerId: optionalString,
  referrerEmail: optionalString,
  referredId: optionalString,
  referredEmail: optionalString,
  referrerIpHash: optionalString,
  referredIpHash: optionalString,
  fingerprint: optionalString,
  createdAt: z.string().trim().min(1).max(64),
})

const scanSchema = z
  .object({
    records: z.array(referralRecordSchema).max(500).optional(),
  })
  .optional()

function parseIntParam(value: string | null): number | undefined {
  if (value === null) return undefined
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : undefined
}

export async function GET(request: Request) {
  if (!limiter.check(clientIp(request))) return authRateLimited()

  const admin = await requireAdmin(request)
  if (admin instanceof NextResponse) return admin

  const params = new URL(request.url).searchParams
  const statusParam = params.get("status")?.trim() ?? ""
  if (statusParam && !isReferralFraudFlagStatus(statusParam)) {
    return fail(
      400,
      "invalid_request",
      `status must be one of: ${REFERRAL_FRAUD_FLAG_STATUSES.join(", ")}.`,
    )
  }

  const limit = parseIntParam(params.get("limit"))
  const offset = parseIntParam(params.get("offset"))
  if (
    (params.get("limit") !== null && limit === undefined) ||
    (params.get("offset") !== null && offset === undefined)
  ) {
    return fail(400, "invalid_request", "limit and offset must be integers.")
  }

  const result = listFlags({
    ...(statusParam
      ? { status: statusParam as (typeof REFERRAL_FRAUD_FLAG_STATUSES)[number] }
      : {}),
    ...(limit !== undefined ? { limit } : {}),
    ...(offset !== undefined ? { offset } : {}),
  })
  return ok({ flags: result.items.map(flagJson), total: result.total })
}

export async function POST(request: Request) {
  if (!limiter.check(clientIp(request))) return authRateLimited()

  const admin = await requireAdmin(request)
  if (admin instanceof NextResponse) return admin

  let body: unknown
  try {
    body = await request.json()
  } catch {
    body = undefined // empty body → scan the stored records
  }

  const parsed = scanSchema.safeParse(body ?? {})
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "Invalid scan request."
    return fail(400, "invalid_request", message)
  }

  try {
    const records = parsed.data?.records
    if (records) {
      for (const record of records) addReferralRecord(record as ReferralRecord)
    }
    const flags = scanReferrals()
    return ok({ flags: flags.map(flagJson), flagged: flags.length })
  } catch {
    return fail(500, "internal", "Could not run the fraud scan.")
  }
}
