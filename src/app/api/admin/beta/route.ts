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
import { betaProgramJson, createProgram, listPrograms } from "@/lib/beta-access"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * /api/admin/beta
 *
 * GET  — every beta program (open and closed), newest first, each with its
 *        enrolled-user count. Enrollment detail lives on
 *        `GET /api/admin/beta/[id]`.
 * POST — create a program `{ name, description }`. New programs start
 *        `open` so users can self-enroll immediately.
 *
 * Admin-only via `requireAdmin`, same-origin enforced on POST, both
 * rate limited. The store is the in-memory dev seam described in
 * `src/lib/beta-access.ts`.
 */

const limiter = createAuthRateLimiter(AUTH_LIMITS.publicRead)

const NAME_MAX = 120
const DESCRIPTION_MAX = 2000

const createSchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(NAME_MAX, "Name is too long."),
  description: z.string().trim().max(DESCRIPTION_MAX, "Description is too long.").default(""),
})

export async function GET(request: Request) {
  if (!limiter.check(clientIp(request))) return authRateLimited()

  const admin = await requireAdmin(request)
  if (admin instanceof NextResponse) return admin

  return ok({ programs: listPrograms().map(betaProgramJson) })
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
    const message = parsed.error.issues[0]?.message ?? "Invalid beta program."
    return fail(400, "invalid_request", message)
  }

  try {
    const program = createProgram(parsed.data)
    return ok({ program: betaProgramJson(program) })
  } catch (error) {
    return fail(
      400,
      "invalid_request",
      error instanceof Error ? error.message : "Invalid beta program.",
    )
  }
}
