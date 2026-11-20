import { NextResponse } from "next/server"
import { z } from "zod"

import { requireAdmin } from "@/lib/admin-guard"
import {
  AUTH_LIMITS,
  authRateLimited,
  clientIp,
  createAuthRateLimiter,
} from "@/lib/auth-endpoint-rate-limit"
import { fail, isSameOriginRequest, ok } from "@/lib/auth/http"
import { PayoutTransitionError, PayoutValidationError, getRun, processRun } from "@/lib/payouts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * /api/admin/payouts/[id]
 *
 * GET  — one payout run plus its items (`{ run, items }`).
 * POST — `{ action: "process" }` runs the SIMULATED payout processor
 *        (`processRun` in `src/lib/payouts.ts`): every outstanding item is
 *        marked `paid` or `failed` by deterministic rules (missing payout
 *        method, amount over the simulated limit). NO REAL MONEY MOVES.
 *        A `failed` run may be re-processed after fixing settings — only
 *        failed items are re-evaluated. `completed` is terminal (409);
 *        unknown ids 404.
 *
 * Admin-only via `requireAdmin`, same-origin enforced on POST, rate limited.
 */

const limiter = createAuthRateLimiter(AUTH_LIMITS.publicRead)

const postSchema = z.object({
  action: z.enum(["process"]),
})

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!limiter.check(clientIp(request))) return authRateLimited()

  const admin = await requireAdmin(request)
  if (admin instanceof NextResponse) return admin

  const { id } = await context.params
  const detail = getRun(id)
  if (!detail) {
    return fail(404, "not_found", "Payout run not found.")
  }
  return ok({ run: detail.run, items: detail.items })
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isSameOriginRequest(request)) {
    return fail(403, "forbidden", "Cross-origin request blocked.")
  }
  if (!limiter.check(clientIp(request))) return authRateLimited()

  const admin = await requireAdmin(request)
  if (admin instanceof NextResponse) return admin

  const { id } = await context.params

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

  try {
    const run = processRun(id)
    const detail = getRun(id)
    return ok({ run, items: detail?.items ?? [] })
  } catch (error) {
    if (error instanceof PayoutTransitionError) {
      return fail(409, "invalid_transition", error.message)
    }
    if (error instanceof PayoutValidationError) {
      return fail(404, "not_found", error.message)
    }
    throw error
  }
}
