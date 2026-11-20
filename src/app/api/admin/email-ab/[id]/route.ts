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
  concludeExperiment,
  EMAIL_AB_STATUSES,
  getExperiment,
  isEmailAbStatus,
  updateExperimentStatus,
} from "@/lib/email-ab"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * /api/admin/email-ab/[id]
 *
 * GET   — one experiment.
 * PATCH — `{ status?, winnerKey? }`. Status transitions follow
 *         draft→running→paused→running; `status: "concluded"` requires
 *         `winnerKey` naming one of the experiment's variants and is the
 *         only way to conclude. Concluded experiments are immutable.
 *
 * Admin-only via `requireAdmin`. Assignment is handled by `pickVariant` in
 * `src/lib/email-ab.ts`; nothing here sends email.
 */

const limiter = createAuthRateLimiter(AUTH_LIMITS.publicRead)

const patchSchema = z
  .object({
    status: z.string().optional(),
    winnerKey: z.string().trim().min(1).max(60).optional(),
  })
  .refine((value) => value.status !== undefined || value.winnerKey !== undefined, {
    message: "Provide status and/or winnerKey.",
  })

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(request: Request, context: RouteContext) {
  if (!limiter.check(clientIp(request))) return authRateLimited()

  const admin = await requireAdmin(request)
  if (admin instanceof NextResponse) return admin

  const { id } = await context.params
  const experiment = getExperiment(id)
  if (!experiment) return fail(404, "not_found", "Experiment not found.")
  return ok({ experiment })
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

  const existing = getExperiment(id)
  if (!existing) return fail(404, "not_found", "Experiment not found.")

  const { status, winnerKey } = parsed.data

  if (status !== undefined) {
    if (!isEmailAbStatus(status)) {
      return fail(400, "invalid_request", `status must be one of: ${EMAIL_AB_STATUSES.join(", ")}.`)
    }

    if (status === "concluded") {
      if (!winnerKey) {
        return fail(400, "invalid_request", "Concluding requires winnerKey.")
      }
      const concluded = concludeExperiment(id, winnerKey)
      if (!concluded) {
        return fail(
          400,
          "invalid_request",
          "Cannot conclude: experiment must be running or paused and winnerKey must match a variant.",
        )
      }
      return ok({ experiment: concluded })
    }

    const updated = updateExperimentStatus(id, status)
    if (!updated) {
      return fail(
        400,
        "invalid_request",
        `Cannot transition from "${existing.status}" to "${status}".`,
      )
    }
    return ok({ experiment: updated })
  }

  // winnerKey without status: only meaningful on an already-concluded
  // experiment, which is immutable — reject.
  return fail(400, "invalid_request", 'winnerKey is only accepted with status "concluded".')
}
