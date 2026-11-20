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
import { deleteFlag, getFlagById, updateFlag } from "@/lib/feature-flags"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * /api/admin/feature-flags/[id]
 *
 * GET    — one flag.
 * PATCH  — partial update `{ name?, description?, enabled?, rolloutPercent?,
 *          targetUserIds?, targetEmails? }`. `key` is immutable. Pass
 *          `rolloutPercent`/`targetUserIds`/`targetEmails` as `null` to
 *          clear them.
 * DELETE — remove the flag. Callers stop receiving it on the next
 *          `GET /api/feature-flags` evaluation.
 *
 * Admin-only via `requireAdmin`, same-origin enforced on mutations, rate
 * limited. The store is the in-memory dev seam described in
 * `src/lib/feature-flags.ts`.
 */

const limiter = createAuthRateLimiter(AUTH_LIMITS.publicRead)

const patchSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required.").max(200, "Name is too long.").optional(),
    description: z.string().trim().max(2000, "Description is too long.").optional(),
    enabled: z.boolean().optional(),
    rolloutPercent: z.number().min(0).max(100).nullable().optional(),
    targetUserIds: z.array(z.string().trim().min(1).max(200)).max(500).nullable().optional(),
    targetEmails: z.array(z.string().trim().min(1).max(320)).max(500).nullable().optional(),
  })
  .refine(
    (value) =>
      value.name !== undefined ||
      value.description !== undefined ||
      value.enabled !== undefined ||
      value.rolloutPercent !== undefined ||
      value.targetUserIds !== undefined ||
      value.targetEmails !== undefined,
    { message: "Provide at least one field to update." },
  )

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(request: Request, context: RouteContext) {
  if (!limiter.check(clientIp(request))) return authRateLimited()

  const admin = await requireAdmin(request)
  if (admin instanceof NextResponse) return admin

  const { id } = await context.params
  const flag = getFlagById(id)
  if (!flag) return fail(404, "not_found", "Feature flag not found.")
  return ok({ flag })
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

  try {
    const flag = updateFlag(id, parsed.data)
    if (!flag) return fail(404, "not_found", "Feature flag not found.")
    return ok({ flag })
  } catch (error) {
    return fail(400, "invalid_request", error instanceof Error ? error.message : "Invalid request.")
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  if (!isSameOriginRequest(request)) {
    return fail(403, "forbidden", "Cross-origin request blocked.")
  }
  if (!limiter.check(clientIp(request))) return authRateLimited()

  const admin = await requireAdmin(request)
  if (admin instanceof NextResponse) return admin

  const { id } = await context.params
  if (!deleteFlag(id)) return fail(404, "not_found", "Feature flag not found.")
  return ok({ deleted: true })
}
