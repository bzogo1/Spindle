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
  createExperiment,
  LANDING_AB_MAX_VARIANTS,
  LANDING_AB_MIN_VARIANTS,
  LANDING_AB_STATUSES,
  LandingAbError,
  listExperiments,
} from "@/lib/landing-ab"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * /api/admin/landing-ab
 *
 * GET  — list landing A/B experiments, newest first. Optional `?status=`
 *        filter (draft|running|paused|completed).
 * POST — create a draft experiment `{ name, variants, startAt?, endAt? }`
 *        where each variant is `{ id?, weight?, config? }` with
 *        `config: { headline?, ctaLabel?, showSocialProof? }`.
 *
 * Admin-only via `requireAdmin`. Public assignment/event intake lives under
 * `/api/landing-ab/*`; the store is the in-memory dev seam described in
 * `src/lib/landing-ab.ts`.
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

const createSchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(120, "Name is too long."),
  variants: z
    .array(variantSchema)
    .min(LANDING_AB_MIN_VARIANTS, `At least ${LANDING_AB_MIN_VARIANTS} variants are required.`)
    .max(LANDING_AB_MAX_VARIANTS, `At most ${LANDING_AB_MAX_VARIANTS} variants are allowed.`),
  startAt: z.string().datetime({ offset: true }).optional().nullable(),
  endAt: z.string().datetime({ offset: true }).optional().nullable(),
})

function isLandingAbStatusValue(value: string): boolean {
  return (LANDING_AB_STATUSES as readonly string[]).includes(value)
}

export async function GET(request: Request) {
  if (!limiter.check(clientIp(request))) return authRateLimited()

  const admin = await requireAdmin(request)
  if (admin instanceof NextResponse) return admin

  const statusParam = new URL(request.url).searchParams.get("status")?.trim() ?? ""
  if (statusParam && !isLandingAbStatusValue(statusParam)) {
    return fail(400, "invalid_request", `status must be one of: ${LANDING_AB_STATUSES.join(", ")}.`)
  }

  const experiments = listExperiments(
    statusParam ? { status: statusParam as (typeof LANDING_AB_STATUSES)[number] } : undefined,
  )
  return ok({ experiments })
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
    return fail(400, "invalid_request", "Invalid request.")
  }

  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "Invalid experiment."
    return fail(400, "invalid_request", message)
  }

  try {
    const experiment = createExperiment({
      name: parsed.data.name,
      variants: parsed.data.variants,
      ...(parsed.data.startAt ? { startAt: parsed.data.startAt } : {}),
      ...(parsed.data.endAt ? { endAt: parsed.data.endAt } : {}),
    })
    return ok({ experiment })
  } catch (error) {
    if (error instanceof LandingAbError) {
      return fail(400, "invalid_request", error.message)
    }
    return fail(400, "invalid_request", "Invalid experiment.")
  }
}
