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
  createExperiment,
  EMAIL_AB_MAX_VARIANTS,
  EMAIL_AB_MIN_VARIANTS,
  EMAIL_AB_STATUSES,
  isEmailAbStatus,
  listExperiments,
} from "@/lib/email-ab"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * /api/admin/email-ab
 *
 * GET  — list email A/B experiments, newest first. Optional `?status=`
 *        filter (draft|running|paused|concluded).
 * POST — create a draft experiment `{ name, emailKey, variants }` where each
 *        variant is `{ key, subject, body? }` (2–4 variants, unique keys).
 *        Only a truncated `bodyPreview` is persisted per variant.
 *
 * Admin-only via `requireAdmin`. Assignment is handled by
 * `pickVariant` in `src/lib/email-ab.ts`; send-path wiring is a separate
 * task — nothing here sends email. The store is the in-memory dev seam
 * described in `src/lib/email-ab.ts`.
 */

const limiter = createAuthRateLimiter(AUTH_LIMITS.publicRead)

const variantSchema = z.object({
  key: z.string().trim().min(1, "Variant key is required.").max(60, "Variant key is too long."),
  subject: z
    .string()
    .trim()
    .min(1, "Variant subject is required.")
    .max(200, "Subject is too long."),
  body: z.string().max(50_000, "Body is too long.").optional(),
})

const createSchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(120, "Name is too long."),
  emailKey: z.string().trim().min(1, "emailKey is required.").max(120, "emailKey is too long."),
  variants: z
    .array(variantSchema)
    .min(EMAIL_AB_MIN_VARIANTS, `At least ${EMAIL_AB_MIN_VARIANTS} variants are required.`)
    .max(EMAIL_AB_MAX_VARIANTS, `At most ${EMAIL_AB_MAX_VARIANTS} variants are allowed.`),
})

export async function GET(request: Request) {
  if (!limiter.check(clientIp(request))) return authRateLimited()

  const admin = await requireAdmin(request)
  if (admin instanceof NextResponse) return admin

  const statusParam = new URL(request.url).searchParams.get("status")?.trim() ?? ""
  if (statusParam && !isEmailAbStatus(statusParam)) {
    return fail(400, "invalid_request", `status must be one of: ${EMAIL_AB_STATUSES.join(", ")}.`)
  }

  const experiments = listExperiments(
    statusParam ? { status: statusParam as (typeof EMAIL_AB_STATUSES)[number] } : undefined,
  )
  return ok({ experiments })
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
    const message = parsed.error.issues[0]?.message ?? "Invalid experiment."
    return fail(400, "invalid_request", message)
  }

  const keys = new Set<string>()
  for (const variant of parsed.data.variants) {
    if (keys.has(variant.key)) {
      return fail(400, "invalid_request", `Duplicate variant key: ${variant.key}.`)
    }
    keys.add(variant.key)
  }

  try {
    const experiment = createExperiment({
      name: parsed.data.name,
      emailKey: parsed.data.emailKey,
      variants: parsed.data.variants.map((variant) => ({
        key: variant.key,
        subject: variant.subject,
        ...(variant.body !== undefined ? { body: variant.body } : {}),
      })),
    })
    return ok({ experiment })
  } catch (error) {
    return fail(
      400,
      "invalid_request",
      error instanceof Error ? error.message : "Invalid experiment.",
    )
  }
}
