import type { ChangelogRelease } from "@/lib/changelog"
import { sendEmail, type EmailDelivery, type EmailMessage } from "@/lib/email"
import { isUnsubscribed, unsubscribePageUrl } from "@/lib/email-unsubscribe"
import { logger } from "@/lib/logger"
import { composeReleaseNotesEmail } from "@/lib/release-notes"
import { siteUrl } from "@/lib/site-url"

/**
 * Sends a composed release-notes email to a bounded recipient list.
 *
 * DEVELOPMENT SEAM / TEST MODE: sends are capped at
 * `RELEASE_NOTES_MAX_RECIPIENTS` per call — the admin UI is a dev-surface for
 * exercising the compose → sendEmail pipeline, not a bulk-mailer. The
 * underlying `sendEmail` is itself a seam: without `RESEND_API_KEY` it returns
 * `"unconfigured"` for every recipient and nothing leaves the process. The
 * result reports `sent` / `unconfigured` / `failed` counts honestly — an
 * unconfigured deployment reports every recipient as unconfigured, never as
 * sent. Recipients who opted out are skipped before any send is attempted and
 * counted as `suppressed`: an address is suppressed when `isUnsubscribed`
 * reports an opt-out in the `"marketing"` or `"newsletter"` scope (each check
 * also folds in the catch-all `"all"` scope — same rule as win-back).
 *
 * Every sent email embeds a per-recipient `unsubscribePageUrl` token scoped to
 * `RELEASE_NOTES_UNSUBSCRIBE_SCOPE` ("newsletter"), matching the scope the
 * newsletter store records on opt-out.
 *
 * `deps.sendEmail` is injectable so tests can exercise the sent/failed paths
 * without mocking modules or hitting the network.
 */

export const RELEASE_NOTES_MAX_RECIPIENTS = 100

/**
 * Opt-out scope embedded in each recipient's unsubscribe token. Release
 * notes go to newsletter subscribers, so "newsletter" matches the scope
 * `newsletter-store.unsubscribe` records.
 */
export const RELEASE_NOTES_UNSUBSCRIBE_SCOPE = "newsletter"

export type ReleaseNotesRecipient = {
  email: string
  /** Optional display name used in the greeting; omitted → "Hi there,". */
  userName?: string
}

export type ReleaseNotesSendDeps = {
  sendEmail?: (message: EmailMessage) => Promise<EmailDelivery>
}

export type ReleaseNotesSendResult = {
  /** Recipients actually attempted after dedupe, opt-out suppression, and cap. */
  attempted: number
  /** Skipped because the address opted out ("marketing"/"newsletter"/"all"). */
  suppressed: number
  sent: number
  unconfigured: number
  failed: number
}

/** True when the address opted out of release-notes/marketing email. */
export function isReleaseNotesSuppressed(email: string): boolean {
  // "marketing" and "newsletter" scopes; isUnsubscribed already folds in
  // the catch-all "all" scope for each check.
  return isUnsubscribed(email, "marketing") || isUnsubscribed(email, "newsletter")
}

export async function sendReleaseNotes(input: {
  entries: ChangelogRelease[]
  recipients: ReleaseNotesRecipient[]
  deps?: ReleaseNotesSendDeps
}): Promise<ReleaseNotesSendResult> {
  const deliver = input.deps?.sendEmail ?? ((message: EmailMessage) => sendEmail(message))

  // Dedupe by normalized address, drop opted-out addresses, then bound the
  // blast radius. Suppression runs before the cap so an opted-out address
  // cannot consume one of the limited send slots.
  const seen = new Set<string>()
  let suppressed = 0
  const recipients = input.recipients
    .filter((recipient) => {
      const key = recipient.email.trim().toLowerCase()
      if (!key || seen.has(key)) return false
      seen.add(key)
      return true
    })
    .filter((recipient) => {
      if (isReleaseNotesSuppressed(recipient.email)) {
        suppressed += 1
        return false
      }
      return true
    })
    .slice(0, RELEASE_NOTES_MAX_RECIPIENTS)

  const result: ReleaseNotesSendResult = {
    attempted: recipients.length,
    suppressed,
    sent: 0,
    unconfigured: 0,
    failed: 0,
  }

  for (const recipient of recipients) {
    const unsubscribeUrl = unsubscribePageUrl({
      email: recipient.email,
      origin: siteUrl,
      scope: RELEASE_NOTES_UNSUBSCRIBE_SCOPE,
    })
    const composed = composeReleaseNotesEmail(input.entries, {
      ...(recipient.userName ? { userName: recipient.userName } : {}),
      unsubscribeUrl,
    })
    try {
      const outcome = await deliver({
        to: recipient.email,
        subject: composed.subject,
        text: composed.text,
        html: composed.html,
      })
      if (outcome === "sent") result.sent += 1
      else result.unconfigured += 1
    } catch (error) {
      result.failed += 1
      logger.warn(
        {
          event: "release_notes.send_failed",
          recipient: recipient.email,
          error: error instanceof Error ? error.message : String(error),
        },
        "Release-notes email failed for recipient",
      )
    }
  }

  logger.info(
    {
      event: "release_notes.send_summary",
      attempted: result.attempted,
      suppressed: result.suppressed,
      sent: result.sent,
      unconfigured: result.unconfigured,
      failed: result.failed,
      entries: input.entries.length,
    },
    "Release-notes send completed",
  )

  return result
}
