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
import { listEnabledFlagKeys } from "@/lib/feature-flags"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * POST /api/admin/feature-flags/evaluate — dry-run flag evaluation for an
 * arbitrary identity `{ email?, userId? }`. Returns the keys of every flag
 * that would be enabled for that subject, using the same
 * `listEnabledFlagKeys` semantics as `GET /api/feature-flags`. Powers the
 * "test evaluation" input on the admin feature-flags screen.
 *
 * Admin-only via `requireAdmin`, same-origin enforced, rate limited. The
 * store is the in-memory dev seam described in `src/lib/feature-flags.ts`.
 */

const limiter = createAuthRateLimiter(AUTH_LIMITS.publicRead)

const evaluateSchema = z
  .object({
    email: z.string().trim().email("email must be a valid email address.").optional(),
    userId: z.string().trim().min(1).max(200).optional(),
  })
  .refine((value) => value.email !== undefined || value.userId !== undefined, {
    message: "Provide email and/or userId.",
  })

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

  const parsed = evaluateSchema.safeParse(body)
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "Invalid request."
    return fail(400, "invalid_request", message)
  }

  return ok({ flags: listEnabledFlagKeys(parsed.data) })
}
