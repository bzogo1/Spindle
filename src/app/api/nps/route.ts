import { NextResponse } from "next/server"

import { logger } from "@/lib/logger"
import { npsSchema, recordNpsResponse } from "@/lib/nps"
import {
  clientIp,
  createRateLimiter,
  HONEYPOT_FIELD,
  isHoneypotTriggered,
  toFieldErrors,
} from "@/lib/site-forms"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const ok = (message: string) => NextResponse.json({ ok: true, message })
const fail = (status: number, message: string, errors?: Record<string, string>) =>
  NextResponse.json({ ok: false, message, ...(errors ? { errors } : {}) }, { status })

// Best-effort per-instance limit; see createRateLimiter for caveats. The limit
// is looser than the contact form because a dismissed-then-reopened survey can
// legitimately submit more than once from shared IPs.
const limiter = createRateLimiter({ limit: 20, windowMs: 60 * 60 * 1000 })

export async function POST(request: Request) {
  if (!limiter.check(clientIp(request))) {
    return fail(429, "Too many responses. Please try again later.")
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return fail(400, "Invalid request.")
  }

  const parsed = npsSchema.safeParse(body)
  if (!parsed.success) {
    return fail(400, "Please check the survey and try again.", toFieldErrors(parsed.error))
  }

  const input = parsed.data

  // Silent success for honeypot hits: bots learn nothing, humans never see it.
  if (isHoneypotTriggered(input[HONEYPOT_FIELD])) {
    logger.warn({ event: "nps.honeypot" }, "NPS survey honeypot triggered")
    return ok("Thanks for the feedback!")
  }

  const response = recordNpsResponse({
    score: input.score,
    comment: input.comment,
    source: input.source,
  })

  logger.info(
    { event: "nps.submission", id: response.id, score: response.score },
    "NPS survey response recorded",
  )

  return ok("Thanks for the feedback!")
}
