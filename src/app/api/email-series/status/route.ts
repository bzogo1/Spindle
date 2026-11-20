import { fail } from "@/lib/auth/http"
import { getEmailSeriesEnrollment } from "@/lib/email-series"
import { clientIp, createRateLimiter } from "@/lib/site-forms"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// Best-effort per-instance limit; see createRateLimiter for caveats.
const limiter = createRateLimiter({ limit: 30, windowMs: 60 * 60 * 1000 })

/**
 * GET /api/email-series/status?email=...&series=welcome
 *
 * Read-only enrollment status for support/debugging. Exposes step ids and
 * timestamps only — no message content.
 */
export async function GET(request: Request) {
  if (!limiter.check(clientIp(request))) {
    return fail(429, "rate_limited", "Too many attempts. Try again later.")
  }

  const url = new URL(request.url)
  const email = url.searchParams.get("email")
  const seriesId = url.searchParams.get("series") ?? undefined

  if (!email || !email.includes("@")) {
    return fail(400, "invalid_request", "A valid email query parameter is required.")
  }

  const enrollment = getEmailSeriesEnrollment(email, seriesId)
  if (!enrollment) {
    return Response.json({ ok: true, enrolled: false })
  }

  return Response.json({
    ok: true,
    enrolled: true,
    status: enrollment.status,
    nextStepIndex: enrollment.nextStepIndex,
    nextSendAt: Number.isFinite(enrollment.nextSendAt)
      ? new Date(enrollment.nextSendAt).toISOString()
      : null,
    sentSteps: enrollment.sentSteps,
    skippedSteps: enrollment.skippedSteps,
    failedSteps: enrollment.failedSteps,
  })
}
