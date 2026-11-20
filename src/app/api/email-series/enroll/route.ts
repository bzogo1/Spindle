import { z } from "zod"

import { fail, isSameOriginRequest } from "@/lib/auth/http"
import { enrollEmailSeries } from "@/lib/email-series"
import { clientIp, createRateLimiter } from "@/lib/site-forms"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const enrollSchema = z.object({
  email: z.email("Enter a valid email address.").max(320),
  name: z.string().trim().max(80).optional(),
})

// Best-effort per-instance limit; see createRateLimiter for caveats.
const limiter = createRateLimiter({ limit: 10, windowMs: 60 * 60 * 1000 })

/**
 * POST /api/email-series/enroll — { email, name? }
 *
 * Public enrollment hook for the welcome drip series. The signup route is the
 * primary caller (it should invoke `enrollEmailSeries` directly with the new
 * user's id as `principal`); this endpoint exists for flows that only know an
 * email address. Idempotent — repeat calls return the existing enrollment.
 *
 * The day-0 step is sent by the next `processEmailSeriesQueue()` tick (cron or
 * `POST /api/email-series/tick`), not inline.
 */
export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return fail(403, "forbidden", "Cross-origin request blocked.")
  }
  if (!limiter.check(clientIp(request))) {
    return fail(429, "rate_limited", "Too many attempts. Try again later.")
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return fail(400, "invalid_request", "Request body must be JSON.")
  }

  const parsed = enrollSchema.safeParse(body)
  if (!parsed.success) {
    return fail(400, "invalid_request", "Please check the email address and try again.")
  }

  const { enrollment, alreadyEnrolled } = enrollEmailSeries({
    email: parsed.data.email,
    ...(parsed.data.name ? { name: parsed.data.name } : {}),
  })

  return Response.json({
    ok: true,
    alreadyEnrolled,
    status: enrollment.status,
    nextSendAt: Number.isFinite(enrollment.nextSendAt)
      ? new Date(enrollment.nextSendAt).toISOString()
      : null,
    sentSteps: enrollment.sentSteps,
  })
}
