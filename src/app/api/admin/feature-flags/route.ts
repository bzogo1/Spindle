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
import { createFlag, listFlags } from "@/lib/feature-flags"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * /api/admin/feature-flags
 *
 * GET  — every stored feature flag, newest first (enabled and disabled).
 * POST — create a flag `{ key, name, description?, enabled?,
 *        rolloutPercent?, targetUserIds?, targetEmails? }`. `key` is the
 *        stable identifier evaluated by `isFeatureEnabled` /
 *        `GET /api/feature-flags`; it is immutable after creation.
 *
 * Admin-only via `requireAdmin`, same-origin enforced on POST, both
 * rate limited. The store is the in-memory dev seam described in
 * `src/lib/feature-flags.ts`.
 */

const limiter = createAuthRateLimiter(AUTH_LIMITS.publicRead)

const flagFields = {
  name: z.string().trim().min(1, "Name is required.").max(200, "Name is too long."),
  description: z.string().trim().max(2000, "Description is too long.").optional(),
  enabled: z.boolean().optional(),
  rolloutPercent: z.number().min(0).max(100).optional(),
  targetUserIds: z.array(z.string().trim().min(1).max(200)).max(500).optional(),
  targetEmails: z.array(z.string().trim().min(1).max(320)).max(500).optional(),
}

const createSchema = z.object({
  key: z
    .string()
    .trim()
    .min(1, "key is required.")
    .max(128, "key is too long.")
    .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, "key contains invalid characters."),
  ...flagFields,
})

export async function GET(request: Request) {
  if (!limiter.check(clientIp(request))) return authRateLimited()

  const admin = await requireAdmin(request)
  if (admin instanceof NextResponse) return admin

  return ok({ flags: listFlags() })
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

  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "Invalid flag."
    return fail(400, "invalid_request", message)
  }

  try {
    const flag = createFlag(parsed.data)
    return ok({ flag })
  } catch (error) {
    return fail(400, "invalid_request", error instanceof Error ? error.message : "Invalid flag.")
  }
}
