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
  COMPLIANCE_CASE_STATUSES,
  COMPLIANCE_NOTE_BODY_MAX,
  ComplianceError,
  addNote,
  complianceCaseJson,
  getCase,
  transitionCase,
} from "@/lib/compliance"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * /api/admin/compliance/cases/[id]
 *
 * GET   — one compliance case including its append-only note log.
 * PATCH — `{ action: "add_note", body }` appends a note authored by the
 *         admin, or `{ action: "transition", to }` moves the case through
 *         the state machine in `src/lib/compliance.ts`
 *         (open → investigating → resolved|dismissed; resolved/dismissed
 *         terminal). Transitions also write a system note into the log.
 *         Illegal moves are 409, unknown ids 404.
 *
 * Admin-only via `requireAdmin`, same-origin enforced on PATCH, rate
 * limited. Cases live in the in-memory dev seam in `src/lib/compliance.ts`.
 */

const limiter = createAuthRateLimiter(AUTH_LIMITS.publicRead)

const patchSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("add_note"),
    body: z.string().trim().min(1, "body is required.").max(COMPLIANCE_NOTE_BODY_MAX),
  }),
  z.object({
    action: z.literal("transition"),
    to: z.enum(COMPLIANCE_CASE_STATUSES),
  }),
])

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(request: Request, context: RouteContext) {
  if (!limiter.check(clientIp(request))) return authRateLimited()

  const admin = await requireAdmin(request)
  if (admin instanceof NextResponse) return admin

  const { id } = await context.params
  const record = getCase(id)
  if (!record) return fail(404, "not_found", "Compliance case not found.")
  return ok({ case: complianceCaseJson(record) })
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
    return fail(400, "invalid_request", "Request body must be JSON.")
  }

  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "Invalid request."
    return fail(400, "invalid_request", message)
  }

  try {
    const record =
      parsed.data.action === "add_note"
        ? addNote(id, admin.email, parsed.data.body)
        : transitionCase(id, parsed.data.to, { actorId: admin.email })
    return ok({ case: complianceCaseJson(record) })
  } catch (error) {
    if (error instanceof ComplianceError) {
      if (error.code === "not_found") {
        return fail(404, "not_found", error.message)
      }
      if (error.code === "invalid_transition") {
        return fail(409, "invalid_transition", error.message)
      }
      return fail(400, "invalid_request", error.message)
    }
    return fail(500, "internal", "Could not update the compliance case.")
  }
}
