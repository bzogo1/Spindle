import { NextResponse } from "next/server"

import { sendEmail } from "@/lib/email"
import { logger } from "@/lib/logger"
import { subscribe } from "@/lib/newsletter-store"
import {
  clientIp,
  createRateLimiter,
  HONEYPOT_FIELD,
  isHoneypotTriggered,
  newsletterSchema,
  NEWSLETTER_SOURCE,
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
    return fail(429, "Too many attempts. Please try again later.")
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return fail(400, "Invalid request.")
  }

  const parsed = newsletterSchema.safeParse(body)
  if (!parsed.success) {
    return fail(400, "Please check the form and try again.", toFieldErrors(parsed.error))
  }

  const { email, source, consent } = parsed.data

  if (isHoneypotTriggered(parsed.data[HONEYPOT_FIELD])) {
    logger.warn({ event: "newsletter.honeypot" }, "Newsletter honeypot triggered")
    return ok("You're subscribed. Watch your inbox.")
  }

  logger.info(
    {
      event: "newsletter.submission",
      source: source ?? NEWSLETTER_SOURCE,
      // Audit trail only; consent is not persisted yet.
      consent,
    },
    "Newsletter subscription received",
  )

  try {
    const delivery = await sendEmail({
      to: email,
      subject: "You're on the Spindle list",
      text: [
        "Thanks for subscribing.",
        "",
        "You'll hear from us when something worth your attention ships —",
        "no noise, no weekly filler. To unsubscribe, just reply to this",
        "email and ask, or use the unsubscribe link in any future message.",
        "",
        "— The Spindle team",
      ].join("\n"),
    })

    if (delivery === "sent") {
      logger.info({ event: "newsletter.confirmation_sent" }, "Newsletter confirmation emailed")
    } else {
      logger.info(
        { event: "newsletter.logged_only" },
        "Resend not configured; subscription logged only",
      )
    }
  } catch (error) {
    logger.error(
      { event: "newsletter.delivery_failed", err: error },
      "Newsletter confirmation email failed",
    )
    return fail(502, "Something went wrong. Please try again.")
  }

  // Persist the subscription for the admin newsletter screen. Best-effort:
  // a store failure must not break the subscribe response.
  try {
    subscribe(email, source ?? NEWSLETTER_SOURCE)
  } catch (error) {
    logger.warn(
      { event: "newsletter.store_failed", err: error },
      "Newsletter subscriber could not be recorded",
    )
  }

  return ok("You're subscribed. Watch your inbox.")
}
