import type { EnvSource } from "./env"
import { getServerEnv } from "./env.server"
import { logger } from "./logger"

/**
 * Transactional email via the Resend HTTP API.
 *
 * Sending is only attempted when `RESEND_API_KEY` is configured. Callers must
 * treat `"unconfigured"` as a normal outcome: the submission is still logged
 * and acknowledged, it is just not delivered by email. `CONTACT_FROM_EMAIL`
 * must be a sender address on a domain verified in Resend;
 * `CONTACT_TO_EMAIL` is where contact-form deliveries are routed.
 */

export type EmailMessage = {
  to: string
  subject: string
  text: string
  /** Optional HTML rendering sent alongside `text`; both are multipart. */
  html?: string
  replyTo?: string
}

export type EmailDelivery = "sent" | "unconfigured"

const RESEND_ENDPOINT = "https://api.resend.com/emails"

const DEFAULT_FROM = "Spindle <noreply@spindle.example>"
const DEFAULT_CONTACT_TO = "hello@spindle.example"

export function contactRecipient(source?: EnvSource): string {
  return getServerEnv(source).CONTACT_TO_EMAIL ?? DEFAULT_CONTACT_TO
}

export function contactSender(source?: EnvSource): string {
  return getServerEnv(source).CONTACT_FROM_EMAIL ?? DEFAULT_FROM
}

/**
 * Sends one email through Resend. Returns `"unconfigured"` when no API key is
 * present so callers can fall back to log-only delivery; throws on provider
 * errors so the request can surface a retryable failure.
 */
export async function sendEmail(message: EmailMessage, source?: EnvSource): Promise<EmailDelivery> {
  const env = getServerEnv(source)
  const apiKey = env.RESEND_API_KEY
  if (!apiKey) return "unconfigured"

  const response = await fetch(RESEND_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: contactSender(source),
      to: [message.to],
      subject: message.subject,
      text: message.text,
      ...(message.html ? { html: message.html } : {}),
      ...(message.replyTo ? { reply_to: message.replyTo } : {}),
    }),
  })

  if (!response.ok) {
    const detail = await response.text().catch(() => "")
    logger.error(
      { event: "email.send_failed", status: response.status, detail: detail.slice(0, 500) },
      "Resend rejected the email",
    )
    throw new Error(`Resend send failed with status ${response.status}`)
  }

  return "sent"
}
