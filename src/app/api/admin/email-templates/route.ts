import { NextResponse } from "next/server"

import { requireAdmin } from "@/lib/admin-guard"
import {
  AUTH_LIMITS,
  authRateLimited,
  clientIp,
  createAuthRateLimiter,
} from "@/lib/auth-endpoint-rate-limit"
import { fail, ok } from "@/lib/auth/http"
import { createTemplate, EmailTemplateError, listTemplates } from "@/lib/email-templates-editor"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * /api/admin/email-templates
 *
 * GET  — list editable email templates, most recently updated first.
 * POST — create a template `{ name, subject, body }`; `{{variable}}`
 *        placeholders in subject/body are extracted into `variables`.
 *
 * Admin-only via `requireAdmin`. Backed by the in-memory dev-seam store in
 * `src/lib/email-templates-editor.ts` (per-instance, lost on restart; an
 * `EmailTemplate` table is the upgrade path). Nothing here sends email —
 * templates are an editing/preview surface only.
 */

const readLimiter = createAuthRateLimiter(AUTH_LIMITS.publicRead)
const writeLimiter = createAuthRateLimiter(AUTH_LIMITS.emailSend)

export async function GET(request: Request) {
  if (!readLimiter.check(clientIp(request))) return authRateLimited()

  const admin = await requireAdmin(request)
  if (admin instanceof NextResponse) return admin

  return ok({ templates: listTemplates() })
}

export async function POST(request: Request) {
  if (!writeLimiter.check(clientIp(request))) return authRateLimited()

  const admin = await requireAdmin(request)
  if (admin instanceof NextResponse) return admin

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return fail(400, "invalid_request", "Expected a JSON body.")
  }

  try {
    const template = createTemplate(body)
    return ok({ template })
  } catch (error) {
    if (error instanceof EmailTemplateError) {
      // Defensive: `createTemplate` evicts the oldest entry when the bounded
      // store is full, so "store_full" is not thrown today — kept so a future
      // store implementation can surface it as 409 without a route change.
      if (error.code === "store_full") {
        return fail(409, "store_full", error.message)
      }
      return fail(400, "invalid_request", error.message)
    }
    throw error
  }
}
