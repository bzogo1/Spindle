import { NextResponse } from "next/server"

import { feedbackSchema, feedbackStore } from "@/lib/feedback"
import { logger } from "@/lib/logger"
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

// Best-effort per-instance limit; see createRateLimiter for caveats.
const limiter = createRateLimiter({ limit: 10, windowMs: 60 * 60 * 1000 })

export async function POST(request: Request) {
  if (!limiter.check(clientIp(request))) {
    return fail(429, "Too much feedback at once. Please try again later.")
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return fail(400, "Invalid request.")
  }

  const parsed = feedbackSchema.safeParse(body)
  if (!parsed.success) {
    return fail(400, "Please check the form and try again.", toFieldErrors(parsed.error))
  }

  const input = parsed.data

  // Silent success for honeypot hits: bots learn nothing, humans never see it.
  if (isHoneypotTriggered(input[HONEYPOT_FIELD])) {
    logger.warn({ event: "feedback.honeypot" }, "Feedback honeypot triggered")
    return ok("Thanks — your feedback was received.")
  }

  const entry = feedbackStore.add({
    category: input.category,
    message: input.message,
    email: input.email,
  })

  logger.info(
    { event: "feedback.submission", id: entry.id, category: entry.category },
    "Feedback submission received",
  )

  return ok("Thanks — your feedback was received.")
}
