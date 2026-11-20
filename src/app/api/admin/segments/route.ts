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
  createSegment,
  listSegments,
  SEGMENT_COMBINATORS,
  SEGMENT_FIELDS,
  SEGMENT_OPERATORS,
  SEGMENT_VALUE_MAX,
} from "@/lib/segments"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * /api/admin/segments
 *
 * GET  — every stored segment, newest first.
 * POST — create a segment `{ name, description?, combinator?, rules: [
 *        { field, operator, value } ] }`. Rules are validated twice: the zod
 *        schema enforces shape/enums, `createSegment` normalizes and rejects
 *        field/operator/value mismatches (e.g. a domain that is not a domain,
 *        a value on a boolean predicate).
 *
 * Admin-only via `requireAdmin`, same-origin enforced on POST, both
 * rate limited. The store is the in-memory dev seam described in
 * `src/lib/segments.ts`.
 */

const limiter = createAuthRateLimiter(AUTH_LIMITS.publicRead)

const ruleSchema = z.object({
  field: z.enum(SEGMENT_FIELDS),
  operator: z.enum(SEGMENT_OPERATORS),
  value: z.string().max(SEGMENT_VALUE_MAX * 2),
})

const createSchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(120, "Name is too long."),
  description: z.string().trim().max(500, "Description is too long.").optional(),
  combinator: z.enum(SEGMENT_COMBINATORS).optional(),
  rules: z.array(ruleSchema).min(1, "At least one rule is required.").max(20),
})

export async function GET(request: Request) {
  if (!limiter.check(clientIp(request))) return authRateLimited()

  const admin = await requireAdmin(request)
  if (admin instanceof NextResponse) return admin

  return ok({ segments: listSegments() })
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
    const message = parsed.error.issues[0]?.message ?? "Invalid segment."
    return fail(400, "invalid_request", message)
  }

  try {
    const segment = createSegment(parsed.data)
    return ok({ segment })
  } catch (error) {
    return fail(400, "invalid_request", error instanceof Error ? error.message : "Invalid segment.")
  }
}
