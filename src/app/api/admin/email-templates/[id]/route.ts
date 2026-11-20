import { NextResponse } from "next/server"

import { requireAdmin } from "@/lib/admin-guard"
import {
  AUTH_LIMITS,
  authRateLimited,
  clientIp,
  createAuthRateLimiter,
} from "@/lib/auth-endpoint-rate-limit"
import { fail, ok } from "@/lib/auth/http"
import {
  deleteTemplate,
  EmailTemplateError,
  getTemplate,
  updateTemplate,
} from "@/lib/email-templates-editor"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * /api/admin/email-templates/[id]
 *
 * GET    — one template.
 * PUT    — replace fields `{ name?, subject?, body? }` (at least one
 *          required); `variables` is recomputed from subject/body.
 * DELETE — remove the template.
 *
 * Admin-only via `requireAdmin`. Backed by the in-memory dev-seam store in
 * `src/lib/email-templates-editor.ts`.
 */

const readLimiter = createAuthRateLimiter(AUTH_LIMITS.publicRead)
const writeLimiter = createAuthRateLimiter(AUTH_LIMITS.emailSend)

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(request: Request, context: RouteContext) {
  if (!readLimiter.check(clientIp(request))) return authRateLimited()

  const admin = await requireAdmin(request)
  if (admin instanceof NextResponse) return admin

  const { id } = await context.params
  const template = getTemplate(id)
  if (!template) return fail(404, "not_found", "Email template not found.")
  return ok({ template })
}

export async function PUT(request: Request, context: RouteContext) {
  if (!writeLimiter.check(clientIp(request))) return authRateLimited()

  const admin = await requireAdmin(request)
  if (admin instanceof NextResponse) return admin

  const { id } = await context.params

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return fail(400, "invalid_request", "Expected a JSON body.")
  }

  try {
    const template = updateTemplate(id, body)
    if (!template) return fail(404, "not_found", "Email template not found.")
    return ok({ template })
  } catch (error) {
    if (error instanceof EmailTemplateError) {
      return fail(400, "invalid_request", error.message)
    }
    throw error
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  if (!writeLimiter.check(clientIp(request))) return authRateLimited()

  const admin = await requireAdmin(request)
  if (admin instanceof NextResponse) return admin

  const { id } = await context.params
  if (!deleteTemplate(id)) {
    return fail(404, "not_found", "Email template not found.")
  }
  return ok({ deleted: true })
}
