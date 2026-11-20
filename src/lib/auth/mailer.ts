import { sendEmail, type EmailDelivery } from "@/lib/email"
import { clientEnv } from "@/lib/env"
import { siteUrl } from "@/lib/site-url"
import { getServerEnv } from "@/lib/env.server"
import { logger } from "@/lib/logger"
import { renderInvitationReminderEmail, renderTeamInviteEmail } from "@/emails/templates"

/**
 * Builds absolute auth links and delivers them through the transactional
 * email helper (`sendEmail` / Resend). When no provider is configured the
 * message is logged instead — in development the full link is logged so the
 * flow is testable end-to-end; in production only a notice is logged and the
 * link is never written to logs.
 */

export function authLink(path: string): string {
  return new URL(path, siteUrl).toString()
}

export async function sendAuthEmail(input: {
  to: string
  subject: string
  text: string
  /** Optional HTML rendering sent alongside `text`. */
  html?: string
  /** Path used for the dev-mode log line, e.g. "/reset-password/abc". */
  linkPath: string
}): Promise<EmailDelivery> {
  const delivery = await sendEmail({
    to: input.to,
    subject: input.subject,
    text: input.text,
    ...(input.html ? { html: input.html } : {}),
  })
  if (delivery === "unconfigured") {
    if (isProductionRuntime()) {
      logger.warn(
        { event: "auth.email.unconfigured", to: input.to },
        "Auth email could not be sent: RESEND_API_KEY is not configured.",
      )
    } else {
      // Dev convenience: surface the link so the flow works without Resend.
      logger.info(
        { event: "auth.email.dev-link", to: input.to, url: authLink(input.linkPath) },
        "Auth email (dev): link logged because ResEND_API_KEY is unset.",
      )
    }
  }
  return delivery
}

/**
 * `getServerEnv` throws when bundled for the browser (jsdom tests included);
 * fall back to the client-visible NODE_ENV so the production/dev split still
 * works without a server runtime.
 */
function isProductionRuntime(): boolean {
  try {
    return getServerEnv().NODE_ENV === "production"
  } catch {
    return clientEnv.NODE_ENV === "production"
  }
}

/**
 * Delivers a non-auth email (welcome-series drip steps, digests, etc.)
 * through the same `sendEmail`/Resend path as `sendAuthEmail`. Returns the
 * `EmailDelivery` result so callers can distinguish "sent" from
 * "unconfigured"; when unconfigured the outcome is logged — full link in
 * development, a notice only in production.
 */
export async function sendSeriesEmail(input: {
  to: string
  subject: string
  text: string
  /** Optional HTML rendering sent alongside `text`. */
  html?: string
  /** Path used for the dev-mode log line; defaults to the app root. */
  linkPath?: string
}): Promise<EmailDelivery> {
  const delivery = await sendEmail({
    to: input.to,
    subject: input.subject,
    text: input.text,
    ...(input.html ? { html: input.html } : {}),
  })
  if (delivery === "unconfigured") {
    if (isProductionRuntime()) {
      logger.warn(
        { event: "email.series.unconfigured", to: input.to, subject: input.subject },
        "Series email could not be sent: RESEND_API_KEY is not configured.",
      )
    } else {
      logger.info(
        {
          event: "email.series.dev-link",
          to: input.to,
          subject: input.subject,
          url: authLink(input.linkPath ?? "/app"),
        },
        "Series email (dev): logged because RESEND_API_KEY is unset.",
      )
    }
  }
  return delivery
}

/**
 * Delivers a workspace invitation email through `sendAuthEmail` so the
 * dev-mode "link logged" behaviour is identical to other auth mail. `url`
 * is the absolute accept link (`/invite?token=…`); `linkPath` is the same
 * target as a site-relative path used only for the dev log line.
 */
export async function sendInvitationEmail(input: {
  to: string
  workspaceName: string
  inviterName: string
  /** Display role, e.g. "Admin" — interpolated into the copy. */
  role: string
  /** Absolute accept URL containing the single-use invite token. */
  url: string
  /** Site-relative accept path, e.g. "/invite?token=…". */
  linkPath: string
  /** Human-readable expiry shown in the copy; defaults to "7 days". */
  expiresIn?: string
}): Promise<EmailDelivery> {
  const message = renderTeamInviteEmail({
    workspaceName: input.workspaceName,
    inviterName: input.inviterName,
    role: input.role,
    url: input.url,
    ...(input.expiresIn ? { expiresIn: input.expiresIn } : {}),
  })
  return sendAuthEmail({
    to: input.to,
    subject: message.subject,
    text: message.text,
    html: message.html,
    linkPath: input.linkPath,
  })
}

/**
 * Delivers an invitation REMINDER email through `sendAuthEmail`, same dev
 * "link logged" behaviour as {@link sendInvitationEmail}. `url`/`linkPath`
 * carry the EXISTING accept link — reminders never rotate the token (that
 * would invalidate the link in the original email); `expiresIn` is the
 * human-readable time left shown in the copy.
 */
export async function sendInvitationReminderEmail(input: {
  to: string
  workspaceName: string
  inviterName: string
  /** Display role, e.g. "Admin" — interpolated into the copy. */
  role?: string
  /** Absolute accept URL — the same link the original invite carried. */
  url: string
  /** Site-relative accept path used only for the dev log line. */
  linkPath: string
  /** Human-readable time left, e.g. "20 hours". */
  expiresIn?: string
}): Promise<EmailDelivery> {
  const message = renderInvitationReminderEmail({
    workspaceName: input.workspaceName,
    inviterName: input.inviterName,
    ...(input.role ? { role: input.role } : {}),
    url: input.url,
    ...(input.expiresIn ? { expiresIn: input.expiresIn } : {}),
  })
  return sendAuthEmail({
    to: input.to,
    subject: message.subject,
    text: message.text,
    html: message.html,
    linkPath: input.linkPath,
  })
}
