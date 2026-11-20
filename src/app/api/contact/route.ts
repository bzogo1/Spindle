import { NextResponse } from "next/server"

import { contactRecipient, sendEmail } from "@/lib/email"
import { routeSubmission } from "@/lib/contact-routing"
import { logger } from "@/lib/logger"
import {
  assessContactSpam,
  CONTACT_SPAM_LIMITS,
  SPAM_TIMESTAMP_FIELD,
  spamVerdict,
} from "@/lib/contact-spam"
import {
  clientIp,
  contactSchema,
  createContactReference,
  createRateLimiter,
  HONEYPOT_FIELD,
  isHoneypotTriggered,
  toFieldErrors,
  type ContactInput,
} from "@/lib/site-forms"
import { CONTACT_TOPIC_LABELS } from "@/lib/site-form-constants"
import { EMAIL_ORIGIN, renderContactAutoReplyEmail } from "@/emails"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const ok = (message: string, reference?: string) =>
  NextResponse.json({ ok: true, message, ...(reference ? { reference } : {}) })
const fail = (status: number, message: string, errors?: Record<string, string>) =>
  NextResponse.json({ ok: false, message, ...(errors ? { errors } : {}) }, { status })

// Best-effort per-instance limit; see createRateLimiter for caveats.
const limiter = createRateLimiter({ limit: 5, windowMs: 60 * 60 * 1000 })

// Daily velocity ceilings layered on top of the hourly limiter: generous for
// humans, tight enough that one abuser rotating messages or one hammered
// mailbox still gets flagged. Same per-instance caveat as `limiter`.
const DAY_MS = 24 * 60 * 60 * 1000
const ipVelocity = createRateLimiter({
  limit: CONTACT_SPAM_LIMITS.ipSubmissionsPerDay,
  windowMs: DAY_MS,
})
const emailVelocity = createRateLimiter({
  limit: CONTACT_SPAM_LIMITS.emailSubmissionsPerDay,
  windowMs: DAY_MS,
})

/**
 * Best-effort inbox recording. The submission store is a dev seam; a failure
 * here must never change the user-facing response, so errors are logged and
 * swallowed.
 */
function recordSubmission(
  input: ContactInput,
  options: { reference?: string; status?: "new" | "spam"; spamSignals?: string[] } = {},
) {
  try {
    routeSubmission({
      ...(options.reference ? { id: options.reference } : {}),
      name: input.name,
      email: input.email,
      topic: input.topic,
      subject: input.subject,
      message: input.message,
      ...(input.reference ? { reference: input.reference } : {}),
      status: options.status ?? "new",
      ...(options.spamSignals && options.spamSignals.length > 0
        ? { spamSignals: options.spamSignals }
        : {}),
    })
  } catch (error) {
    logger.warn(
      { event: "contact.routing_failed", err: error },
      "Contact submission could not be recorded in the inbox store",
    )
  }
}

function buildMessage(input: {
  name: string
  email: string
  topic: ContactInput["topic"]
  /** Optional order/account/company reference supplied by the visitor. */
  reference?: string
  subject: string
  message: string
  /** Server-generated ticket id shown back to the visitor. */
  ticket: string
}) {
  return [
    `Name: ${input.name}`,
    `Email: ${input.email}`,
    `Topic: ${CONTACT_TOPIC_LABELS[input.topic]}`,
    ...(input.reference ? [`Reference: ${input.reference}`] : []),
    `Subject: ${input.subject}`,
    `Ticket: ${input.ticket}`,
    "",
    input.message,
  ].join("\n")
}

export async function POST(request: Request) {
  const ip = clientIp(request)
  if (!limiter.check(ip)) {
    return fail(429, "Too many messages. Please try again later.")
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return fail(400, "Invalid request.")
  }

  const parsed = contactSchema.safeParse(body)
  if (!parsed.success) {
    return fail(400, "Please check the form and try again.", toFieldErrors(parsed.error))
  }

  const input = parsed.data

  // Silent success for honeypot hits: bots learn nothing, humans never see it.
  if (isHoneypotTriggered(input[HONEYPOT_FIELD])) {
    logger.warn({ event: "contact.honeypot" }, "Contact form honeypot triggered")
    return ok("Thanks — we'll be in touch soon.")
  }

  // Spam scoring: time-trap + content heuristics, plus daily velocity keyed
  // by IP and email. Every parsed submission counts toward velocity, including
  // ones later dropped — bots should not get a free pass by being spammy.
  const signals = assessContactSpam({
    [SPAM_TIMESTAMP_FIELD]: input[SPAM_TIMESTAMP_FIELD],
    name: input.name,
    email: input.email,
    subject: input.subject,
    message: input.message,
  })
  // Both counters must run even when the first already failed, so an
  // over-limit IP cannot shield an over-limit email (or vice versa).
  const ipWithinVelocity = ipVelocity.check(`ip:${ip}`)
  const emailWithinVelocity = emailVelocity.check(`email:${input.email.toLowerCase()}`)
  if (!ipWithinVelocity || !emailWithinVelocity) {
    signals.push({ code: "velocity", severity: "suspicious" })
  }
  const verdict = spamVerdict(signals)
  const signalCodes = signals.map((signal) => signal.code)

  if (verdict === "drop") {
    // Same posture as the honeypot: pretend success, deliver nothing. The
    // submission is still recorded as spam so the admin inbox shows the
    // pattern — recording happens before the silent response.
    logger.warn(
      { event: "contact.spam_dropped", signals: signalCodes },
      "Contact submission dropped as spam",
    )
    recordSubmission(input, { status: "spam", spamSignals: signalCodes })
    return ok("Thanks — we'll be in touch soon.")
  }
  if (verdict === "suspicious") {
    // Still delivered — a false positive must reach a human — but logged so
    // repeated patterns are visible.
    logger.warn(
      { event: "contact.spam_suspicious", signals: signalCodes },
      "Contact submission flagged as suspicious",
    )
  }

  const reference = createContactReference()

  // Record in the admin inbox under the same id the visitor sees as their
  // ticket reference. Suspicious submissions land with status "spam" plus
  // their signal codes so they can be reviewed; clean ones start "new".
  recordSubmission(input, {
    reference,
    status: verdict === "suspicious" ? "spam" : "new",
    spamSignals: signalCodes,
  })

  logger.info(
    {
      event: "contact.submission",
      reference,
      topic: input.topic,
      subject: input.subject.slice(0, 120),
    },
    "Contact form submission received",
  )

  try {
    const delivery = await sendEmail({
      to: contactRecipient(),
      replyTo: input.email,
      subject: `[Contact] ${input.subject}`,
      text: buildMessage({ ...input, ticket: reference }),
    })

    if (delivery === "sent") {
      logger.info({ event: "contact.delivered", reference }, "Contact submission emailed")
    } else {
      logger.info(
        { event: "contact.logged_only", reference },
        "Resend not configured; contact submission logged only",
      )
    }
  } catch (error) {
    // The submission is already logged; report a retryable failure honestly.
    logger.error(
      { event: "contact.delivery_failed", reference, err: error },
      "Contact email delivery failed",
    )
    return fail(502, "We couldn't send your message right now. Please try again.")
  }

  // Best-effort auto-reply to the submitter. A failure here must not fail the
  // request — the notification above is the primary delivery.
  try {
    const autoReply = renderContactAutoReplyEmail({
      name: input.name,
      url: `${EMAIL_ORIGIN}/contact`,
    })
    await sendEmail({
      to: input.email,
      subject: autoReply.subject,
      html: autoReply.html,
      text: autoReply.text,
    })
    logger.info({ event: "contact.autoreply_sent" }, "Contact auto-reply emailed")
  } catch (error) {
    logger.error({ event: "contact.autoreply_failed", err: error }, "Contact auto-reply failed")
  }

  return ok("Thanks — we'll be in touch soon.", reference)
}
