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
  COMPLIANCE_CASE_PRIORITIES,
  COMPLIANCE_CASE_STATUSES,
  COMPLIANCE_CASE_TYPES,
  COMPLIANCE_NOTE_BODY_MAX,
  COMPLIANCE_SUBJECT_TYPES,
  ComplianceError,
  addNote,
  complianceCaseJson,
  createCase,
  listCases,
  type ComplianceCasePriority,
  type ComplianceCaseStatus,
  type ComplianceCaseType,
  type ComplianceSubjectType,
} from "@/lib/compliance"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * /api/admin/compliance/cases
 *
 * GET  — compliance cases, newest first. Filters: `?status=`, `?type=`,
 *        `?priority=`, `?subjectType=`, `?subjectId=`, `?limit=`, `?offset=`.
 * POST — open a case: `{ type, subjectType, subjectId, priority?, note? }`.
 *        `note` is appended as the first note authored by the admin.
 *
 * Admin-only via `requireAdmin`, same-origin enforced on POST, rate limited.
 * Cases live in the in-memory dev seam in `src/lib/compliance.ts`.
 */

const limiter = createAuthRateLimiter(AUTH_LIMITS.publicRead)

const postSchema = z.object({
  type: z.enum(COMPLIANCE_CASE_TYPES),
  subjectType: z.enum(COMPLIANCE_SUBJECT_TYPES),
  subjectId: z.string().trim().min(1, "subjectId is required.").max(200),
  priority: z.enum(COMPLIANCE_CASE_PRIORITIES).optional(),
  note: z.string().trim().min(1).max(COMPLIANCE_NOTE_BODY_MAX).optional(),
})

/**
 * Strict non-negative integer param. Rejects malformed values like
 * "10abc", "1.9", and "-1" (returns "invalid" so the caller answers 400)
 * instead of silently truncating or clamping them.
 */
function parseIntParam(value: string | null): number | undefined | "invalid" {
  if (value === null) return undefined
  const trimmed = value.trim()
  if (!/^\d+$/.test(trimmed)) return "invalid"
  const parsed = Number(trimmed)
  return Number.isSafeInteger(parsed) ? parsed : "invalid"
}

export async function GET(request: Request) {
  if (!limiter.check(clientIp(request))) return authRateLimited()

  const admin = await requireAdmin(request)
  if (admin instanceof NextResponse) return admin

  const params = new URL(request.url).searchParams
  const limit = parseIntParam(params.get("limit"))
  const offset = parseIntParam(params.get("offset"))
  if (limit === "invalid" || offset === "invalid") {
    return fail(400, "invalid_request", "limit and offset must be non-negative integers.")
  }

  const status = params.get("status")?.trim() ?? ""
  if (status && !(COMPLIANCE_CASE_STATUSES as readonly string[]).includes(status)) {
    return fail(
      400,
      "invalid_request",
      `status must be one of: ${COMPLIANCE_CASE_STATUSES.join(", ")}.`,
    )
  }
  const type = params.get("type")?.trim() ?? ""
  if (type && !(COMPLIANCE_CASE_TYPES as readonly string[]).includes(type)) {
    return fail(400, "invalid_request", `type must be one of: ${COMPLIANCE_CASE_TYPES.join(", ")}.`)
  }
  const priority = params.get("priority")?.trim() ?? ""
  if (priority && !(COMPLIANCE_CASE_PRIORITIES as readonly string[]).includes(priority)) {
    return fail(
      400,
      "invalid_request",
      `priority must be one of: ${COMPLIANCE_CASE_PRIORITIES.join(", ")}.`,
    )
  }
  const subjectType = params.get("subjectType")?.trim() ?? ""
  if (subjectType && !(COMPLIANCE_SUBJECT_TYPES as readonly string[]).includes(subjectType)) {
    return fail(
      400,
      "invalid_request",
      `subjectType must be one of: ${COMPLIANCE_SUBJECT_TYPES.join(", ")}.`,
    )
  }
  const subjectId = params.get("subjectId")?.trim() ?? ""

  const result = listCases({
    ...(status ? { status: status as ComplianceCaseStatus } : {}),
    ...(type ? { type: type as ComplianceCaseType } : {}),
    ...(priority ? { priority: priority as ComplianceCasePriority } : {}),
    ...(subjectType ? { subjectType: subjectType as ComplianceSubjectType } : {}),
    ...(subjectId ? { subjectId } : {}),
    ...(limit !== undefined ? { limit } : {}),
    ...(offset !== undefined ? { offset } : {}),
  })
  return ok({ cases: result.items.map(complianceCaseJson), total: result.total })
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

  const parsed = postSchema.safeParse(body)
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "Invalid request."
    return fail(400, "invalid_request", message)
  }

  try {
    let record = createCase(parsed.data)
    if (parsed.data.note) {
      record = addNote(record.id, admin.email, parsed.data.note)
    }
    return ok({ case: complianceCaseJson(record) })
  } catch (error) {
    if (error instanceof ComplianceError) {
      const status = error.code === "capacity" ? 409 : 400
      return fail(status, error.code === "capacity" ? "capacity" : "invalid_request", error.message)
    }
    return fail(500, "internal", "Could not create the compliance case.")
  }
}
