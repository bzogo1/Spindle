import { NextResponse } from "next/server"

import { requireAdmin } from "@/lib/admin-guard"
import { authRateLimited } from "@/lib/auth-endpoint-rate-limit"
import { clientIp, createRateLimiter } from "@/lib/site-forms"
import { fail, ok } from "@/lib/auth/http"
import { previewTemplateSchema, renderTemplate } from "@/lib/email-templates-editor"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * POST /api/admin/email-templates/preview
 *
 * Renders ad-hoc `{ subject, body, vars? }` through the same `{{variable}}`
 * substitution used for stored templates — no store write, nothing is sent.
 * Admin-only via `requireAdmin`. Used by the editor's live preview pane so
 * the client never re-implements substitution.
 */

// Write-tier, not publicRead: the editor fires a debounced preview per
// keystroke, so the 60/min read budget 429s mid-edit. 120/min per IP covers
// sustained typing while staying bounded — same per-IP pattern as the other
// admin write limiters (`createRateLimiter` from `@/lib/site-forms`).
const limiter = createRateLimiter({ limit: 120, windowMs: 60 * 1000 })

export async function POST(request: Request) {
  if (!limiter.check(clientIp(request))) return authRateLimited()

  const admin = await requireAdmin(request)
  if (admin instanceof NextResponse) return admin

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return fail(400, "invalid_request", "Expected a JSON body.")
  }

  const parsed = previewTemplateSchema.safeParse(body)
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "Invalid preview request."
    return fail(400, "invalid_request", message)
  }

  const rendered = renderTemplate(
    { subject: parsed.data.subject, body: parsed.data.body },
    parsed.data.vars ?? {},
  )
  return ok({ subject: rendered.subject, body: rendered.body })
}
