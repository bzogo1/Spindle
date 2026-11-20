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
import { getServerEnv } from "@/lib/env.server"
import {
  REFERRAL_EMAIL_AUDIENCES,
  REFERRAL_EMAIL_MAX_RECIPIENTS,
  REFERRAL_EMAIL_TEMPLATES,
  sendReferralEmails,
} from "@/lib/referral-emails"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * /api/admin/referral-emails
 *
 * POST — `{ template: "invite" | "rewarded" | "announcement",
 *          audience?: "all" | "qualified_only" }`
 *
 * MANUAL TRIGGER ONLY: there is no scheduler, cron, or tick endpoint — an
 * admin fires this explicitly (e.g. from an admin console button). It
 * resolves the referral audience (`"all"` = every referrer with ≥1
 * attribution, `"qualified_only"` = referrers with a qualified/rewarded
 * attribution; capped at `REFERRAL_EMAIL_MAX_RECIPIENTS` = 200), skips
 * addresses that opted out of marketing/newsletter/all, and sends via the
 * `sendEmail` seam with a per-recipient `"marketing"`-scoped unsubscribe
 * link. Returns honest `{ attempted, suppressed, sent, unconfigured,
 * failed }` counts.
 *
 * Admin-only via `requireAdmin`, same-origin enforced, and rate-limited
 * with the `emailSend` preset (5 / 10 min per IP) since each call can fan
 * out to hundreds of outbound emails.
 *
 * DEV SEAM: the audience derives from the in-memory attribution store in
 * `src/lib/referral-program.ts` and delivery is the `sendEmail` seam —
 * without `RESEND_API_KEY` every recipient is reported `unconfigured`,
 * never `sent`.
 */

const sendLimiter = createAuthRateLimiter(AUTH_LIMITS.emailSend)

const postSchema = z.object({
  template: z.enum(REFERRAL_EMAIL_TEMPLATES),
  audience: z.enum(REFERRAL_EMAIL_AUDIENCES).optional(),
})

function emailConfigured(): boolean {
  try {
    return Boolean(getServerEnv().RESEND_API_KEY)
  } catch {
    return false
  }
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return fail(403, "forbidden", "Cross-origin request blocked.")
  }
  if (!sendLimiter.check(clientIp(request))) return authRateLimited()

  const admin = await requireAdmin(request)
  if (admin instanceof NextResponse) return admin

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return fail(400, "invalid_request", "Invalid request.")
  }

  const parsed = postSchema.safeParse(body)
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "Invalid request."
    return fail(400, "invalid_request", message)
  }

  const audience = parsed.data.audience ?? "all"
  const result = await sendReferralEmails({
    template: parsed.data.template,
    audience,
  })

  return ok({
    template: parsed.data.template,
    audience,
    maxRecipients: REFERRAL_EMAIL_MAX_RECIPIENTS,
    result,
    emailConfigured: emailConfigured(),
  })
}
