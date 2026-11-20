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
import {
  concludeExperiment,
  getExperiment,
  LANDING_AB_MAX_VARIANTS,
  LANDING_AB_MIN_VARIANTS,
  LANDING_AB_STATUSES,
  LandingAbError,
  results,
  updateExperiment,
} from "@/lib/landing-ab"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * /api/admin/landing-ab/[id]
 *
 * GET   — one experiment plus its `results` (per-variant assigned/views/
 *         clicks and rates from the in-memory event log).
 * PATCH — `{ name?, variants?, startAt?, endAt?, status?, winnerVariantId? }`.
 *         Editable fields apply via `updateExperiment` (variants only while
 *         `draft`; `status` follows draft→running→paused→running);
 *         `status: "completed"` requires `winnerVariantId` and routes to
 *         `concludeExperiment`. Completed experiments are immutable.
 *
 * Admin-only via `requireAdmin`.
 */

const limiter = createAuthRateLimiter(AUTH_LIMITS.publicRead)

const configSchema = z
  .object({
    headline: z.string().max(500).optional(),
    ctaLabel: z.string().max(500).optional(),
    showSocialProof: z.boolean().optional(),
  })
  .catchall(z.union([z.string().max(500), z.number(), z.boolean()]).optional())

const variantSchema = z.object({
  id: z.string().trim().min(1).max(80).optional(),
  weight: z.number().int().min(1).max(1_000_000).optional(),
  config: configSchema.optional(),
})

const patchSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    variants: z
      .array(variantSchema)
      .min(LANDING_AB_MIN_VARIANTS)
      .max(LANDING_AB_MAX_VARIANTS)
      .optional(),
    startAt: z.string().datetime({ offset: true }).nullable().optional(),
    endAt: z.string().datetime({ offset: true }).nullable().optional(),
    status: z.enum(LANDING_AB_STATUSES).optional(),
    winnerVariantId: z.string().trim().min(1).max(80).optional(),
  })
  .refine(
    (value) =>
      value.name !== undefined ||
      value.variants !== undefined ||
      value.startAt !== undefined ||
      value.endAt !== undefined ||
      value.status !== undefined,
    { message: "Provide at least one field to update." },
  )

type RouteContext = { params: Promise<{ id: string }> }

function errorResponse(error: unknown) {
  if (error instanceof LandingAbError) {
    const status = error.code === "not_found" ? 404 : 400
    return fail(status, error.code === "not_found" ? "not_found" : "invalid_request", error.message)
  }
  return fail(400, "invalid_request", "Invalid request.")
}

export async function GET(request: Request, context: RouteContext) {
  if (!limiter.check(clientIp(request))) return authRateLimited()

  const admin = await requireAdmin(request)
  if (admin instanceof NextResponse) return admin

  const { id } = await context.params
  const experiment = getExperiment(id)
  if (!experiment) return fail(404, "not_found", "Experiment not found.")
  return ok({ experiment, results: results(id) })
}

export async function PATCH(request: Request, context: RouteContext) {
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
    return fail(400, "invalid_request", "Expected a JSON body.")
  }

  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "Invalid request."
    return fail(400, "invalid_request", message)
  }

  const existing = getExperiment(id)
  if (!existing) return fail(404, "not_found", "Experiment not found.")

  const { status, winnerVariantId, ...fields } = parsed.data

  try {
    if (status === "completed") {
      if (winnerVariantId === undefined) {
        return fail(400, "invalid_request", "Concluding requires winnerVariantId.")
      }
      // Field edits are not applied together with conclusion — conclude only.
      if (
        fields.name !== undefined ||
        fields.variants !== undefined ||
        fields.startAt !== undefined ||
        fields.endAt !== undefined
      ) {
        return fail(
          400,
          "invalid_request",
          'Do not combine status "completed" with other field updates.',
        )
      }
      const concluded = concludeExperiment(id, winnerVariantId)
      return ok({ experiment: concluded, results: results(id) })
    }

    if (winnerVariantId !== undefined) {
      return fail(
        400,
        "invalid_request",
        'winnerVariantId is only accepted with status "completed".',
      )
    }

    const updated = updateExperiment(id, {
      ...(fields.name !== undefined ? { name: fields.name } : {}),
      ...(fields.variants !== undefined ? { variants: fields.variants } : {}),
      ...(fields.startAt !== undefined ? { startAt: fields.startAt } : {}),
      ...(fields.endAt !== undefined ? { endAt: fields.endAt } : {}),
      // `status === "completed"` was handled above; the narrowed type no
      // longer includes it, so pass it through directly.
      ...(status !== undefined ? { status } : {}),
    })
    return ok({ experiment: updated, results: results(id) })
  } catch (error) {
    return errorResponse(error)
  }
}
