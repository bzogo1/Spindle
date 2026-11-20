import {
  renderReferralAnnouncementEmail,
  renderReferralInviteEmail,
  renderReferralRewardEmail,
  type RenderedEmail,
} from "@/emails"
import { sendEmail, type EmailDelivery, type EmailMessage } from "@/lib/email"
import { isUnsubscribed, normalizeEmail, unsubscribePageUrl } from "@/lib/email-unsubscribe"
import { logger } from "@/lib/logger"
import { buildReferralShareUrl } from "@/lib/referral"
import {
  getOrCreateReferralCode,
  getReferralProgramSettings,
  listAttributionsForAdmin,
  type ReferralAttributionStatus,
} from "@/lib/referral-program"
import { siteUrl } from "@/lib/site-url"

/**
 * Referral email composition + broadcast send path (issue 093).
 *
 * Three templates (rendered by `src/emails/templates.ts`):
 *  - `"invite"`       — referrer → friend; carries the referrer's share URL
 *                      (`/r/<code>` + UTM) and an optional reward mention
 *                      from `getReferralProgramSettings().rewardLabel`.
 *  - `"rewarded"`     — qualified/rewarded notification to the referrer.
 *  - `"announcement"` — program announcement broadcast to participants.
 *
 * UNSUBSCRIBE SCOPE: every template uses `REFERRAL_EMAIL_UNSUBSCRIBE_SCOPE`
 * (`"marketing"`). The qualified/rewarded notification is arguably
 * account-related, but it is program marketing copy and the safest choice is
 * the marketing scope — an address that opted out of marketing stops hearing
 * about the program entirely (the `"all"` catch-all is folded in by
 * `isUnsubscribed` either way). Suppression checks mirror win-back /
 * release-notes: an address is suppressed when it opted out of `"marketing"`
 * OR `"newsletter"`.
 *
 * Every composed message embeds a per-recipient `unsubscribePageUrl` token —
 * there is no batch/global unsubscribe link.
 *
 * DEVELOPMENT SEAM: the audience is derived from the in-memory attribution
 * store in `referral-program.ts`. `"all"` means every distinct
 * `referrerUserId` with at least one recorded attribution; `"qualified_only"`
 * narrows to referrers with a `qualified` or `rewarded` attribution.
 * Referrers who hold a code but have zero attributions are unreachable —
 * `referral-program.ts` exposes no code-listing seam and it is outside this
 * task's editable surface. Sends are capped at
 * `REFERRAL_EMAIL_MAX_RECIPIENTS` per call; admin-triggered only, no
 * scheduler.
 *
 * Server-only: imports `email.ts` → `env.server`; client components must not
 * import this module.
 */

export const REFERRAL_EMAIL_TEMPLATES = ["invite", "rewarded", "announcement"] as const
export type ReferralEmailTemplate = (typeof REFERRAL_EMAIL_TEMPLATES)[number]

export function isReferralEmailTemplate(value: string): value is ReferralEmailTemplate {
  return (REFERRAL_EMAIL_TEMPLATES as readonly string[]).includes(value)
}

/** Opt-out scope embedded in every recipient's unsubscribe token. */
export const REFERRAL_EMAIL_UNSUBSCRIBE_SCOPE = "marketing"

/** Hard cap on recipients per broadcast so one admin click cannot fan out unboundedly. */
export const REFERRAL_EMAIL_MAX_RECIPIENTS = 200

/**
 * Bound on auth-backend `getUserById` lookups while resolving the audience.
 * The attribution store can hold far more distinct referrers than the send
 * cap; resolution stops once this many user ids were attempted (or the
 * recipient cap is filled), so a broadcast never waits on thousands of
 * sequential backend calls.
 */
export const REFERRAL_EMAIL_MAX_USER_LOOKUPS = 500

export const REFERRAL_EMAIL_AUDIENCES = ["all", "qualified_only"] as const
export type ReferralEmailAudience = (typeof REFERRAL_EMAIL_AUDIENCES)[number]

function rewardLabelOrNull(): string | null {
  const settings = getReferralProgramSettings()
  // The reward mention is only advertised while the program is enabled.
  return settings.enabled ? settings.rewardLabel : null
}

function unsubscribeUrlFor(email: string, origin: string): string {
  return unsubscribePageUrl({
    email,
    origin,
    scope: REFERRAL_EMAIL_UNSUBSCRIBE_SCOPE,
  })
}

/**
 * Composes the invite email for one recipient. `code` is the referrer's
 * canonical `SPN-…` code; the share URL is built with UTM params via
 * `buildReferralShareUrl`. `origin` defaults to the public site URL.
 */
export function composeReferralInviteEmail(input: {
  recipientEmail: string
  referrerName?: string
  code: string
  origin?: string
}): RenderedEmail {
  const origin = input.origin ?? siteUrl
  return renderReferralInviteEmail({
    ...(input.referrerName?.trim() ? { referrerName: input.referrerName.trim() } : {}),
    shareUrl: buildReferralShareUrl(origin, input.code),
    rewardLabel: rewardLabelOrNull(),
    unsubscribeUrl: unsubscribeUrlFor(input.recipientEmail, origin),
  })
}

/**
 * Composes the qualified/rewarded notification for the referrer. The
 * unsubscribe link uses the marketing scope (see module docstring).
 */
export function composeReferralRewardEmail(input: {
  recipientEmail: string
  referrerName?: string
  origin?: string
}): RenderedEmail {
  const origin = input.origin ?? siteUrl
  return renderReferralRewardEmail({
    ...(input.referrerName?.trim() ? { referrerName: input.referrerName.trim() } : {}),
    rewardLabel: rewardLabelOrNull(),
    unsubscribeUrl: unsubscribeUrlFor(input.recipientEmail, origin),
  })
}

/** Composes the program announcement for one recipient. */
export function composeReferralAnnouncementEmail(input: {
  recipientEmail: string
  origin?: string
}): RenderedEmail {
  const origin = input.origin ?? siteUrl
  return renderReferralAnnouncementEmail({
    rewardLabel: rewardLabelOrNull(),
    unsubscribeUrl: unsubscribeUrlFor(input.recipientEmail, origin),
  })
}

/** True when the address opted out of referral/marketing email. */
export function isReferralEmailSuppressed(email: string): boolean {
  // "marketing" and "newsletter" scopes; isUnsubscribed already folds in
  // the catch-all "all" scope for each check.
  return isUnsubscribed(email, "marketing") || isUnsubscribed(email, "newsletter")
}

/* ------------------------------------------------------------------ */
/* Audience resolution                                                 */
/* ------------------------------------------------------------------ */

export interface ReferralEmailRecipient {
  /** Stable per-user key (auth uid or `mock:<email>`). */
  userId: string
  /** Normalized recipient address. */
  email: string
  /** Best-effort display name for personalization. */
  name?: string
}

const MOCK_USER_PREFIX = "mock:"

/**
 * Resolves a referral `userId` to a deliverable address. `mock:<email>`
 * ids decode directly; real uids go through the auth backend
 * (`getUserById`), lazily imported and best-effort — a backend miss or
 * failure yields `null` and the referrer is skipped rather than failing
 * the whole broadcast.
 */
async function resolveRecipientUser(
  userId: string,
): Promise<{ email: string; name?: string } | null> {
  if (userId.startsWith(MOCK_USER_PREFIX)) {
    const email = normalizeEmail(userId.slice(MOCK_USER_PREFIX.length))
    return email ? { email } : null
  }

  try {
    const mod = await import("@/lib/auth/backend")
    const user = await mod.getAuthBackend().getUserById(userId)
    const email = user?.email ? normalizeEmail(user.email) : ""
    if (!email) return null
    const name = user?.name?.trim()
    return { email, ...(name ? { name } : {}) }
  } catch {
    return null
  }
}

/**
 * Collects the distinct `referrerUserId`s for an audience from the
 * attribution store. `"all"` = every referrer with ≥1 attribution;
 * `"qualified_only"` = referrers with a `qualified` or `rewarded`
 * attribution. Paginates `listAttributionsForAdmin` (500/page) up to the
 * store cap so large stores are covered; insertion order of first
 * appearance is preserved.
 */
function audienceReferrerIds(audience: ReferralEmailAudience): string[] {
  const wanted = new Set<ReferralAttributionStatus>(
    audience === "qualified_only"
      ? ["qualified", "rewarded"]
      : ["pending", "qualified", "rewarded", "rejected"],
  )
  const ids = new Set<string>()
  const pageSize = 500
  // The attribution store is hard-capped at REFERRAL_ATTRIBUTIONS_STORE_MAX
  // (10_000); two extra pages of headroom cover any future cap bump.
  const maxPages = Math.ceil(12_000 / pageSize)
  for (let page = 0; page < maxPages; page += 1) {
    const { items } = listAttributionsForAdmin({ limit: pageSize, offset: page * pageSize })
    if (items.length === 0) break
    for (const attribution of items) {
      if (!wanted.has(attribution.status)) continue
      ids.add(attribution.referrerUserId)
    }
    if (items.length < pageSize) break
  }
  return [...ids]
}

/**
 * Resolves an audience into deduplicated, deliverable recipients, capped
 * at {@link REFERRAL_EMAIL_MAX_RECIPIENTS}. Order is first-appearance in
 * the attribution store (oldest attributions first — `listAttributionsForAdmin`
 * returns newest first, so pages are walked newest→oldest and the first
 * 200 resolved addresses win).
 */
export async function listReferralEmailRecipients(
  audience: ReferralEmailAudience,
): Promise<ReferralEmailRecipient[]> {
  const recipients: ReferralEmailRecipient[] = []
  const seenEmails = new Set<string>()
  const userIds = audienceReferrerIds(audience)
  let lookups = 0

  for (const userId of userIds) {
    if (recipients.length >= REFERRAL_EMAIL_MAX_RECIPIENTS) break
    if (lookups >= REFERRAL_EMAIL_MAX_USER_LOOKUPS) break
    lookups += 1
    const resolved = await resolveRecipientUser(userId)
    if (!resolved || seenEmails.has(resolved.email)) continue
    seenEmails.add(resolved.email)
    recipients.push({
      userId,
      email: resolved.email,
      ...(resolved.name ? { name: resolved.name } : {}),
    })
  }
  return recipients
}

/* ------------------------------------------------------------------ */
/* Broadcast send                                                      */
/* ------------------------------------------------------------------ */

export type ReferralEmailSendDeps = {
  sendEmail?: (message: EmailMessage) => Promise<EmailDelivery>
}

export type ReferralEmailSendResult = {
  /** Recipients actually attempted after dedupe and opt-out suppression. */
  attempted: number
  /** Skipped because the address opted out ("marketing"/"newsletter"/"all"). */
  suppressed: number
  sent: number
  unconfigured: number
  failed: number
}

/**
 * Composes and sends one referral template to an audience. Manual-trigger
 * only — called from `POST /api/admin/referral-emails`; nothing schedules
 * this.
 *
 * For `"invite"` broadcasts each recipient gets an email containing *their
 * own* referral share link (a "share your link" nudge rendered with the
 * invite template). `"rewarded"` sends the qualified notification and
 * `"announcement"` the program announcement.
 *
 * Opted-out recipients are skipped before any send is attempted; every
 * attempted send embeds a per-recipient unsubscribe token scoped to
 * `"marketing"`. `deps.sendEmail` is injectable so tests can exercise the
 * sent/failed paths without the network.
 */
export async function sendReferralEmails(input: {
  template: ReferralEmailTemplate
  audience?: ReferralEmailAudience
  deps?: ReferralEmailSendDeps
}): Promise<ReferralEmailSendResult> {
  const deliver = input.deps?.sendEmail ?? ((message: EmailMessage) => sendEmail(message))
  const audience = input.audience ?? "all"

  const recipients = await listReferralEmailRecipients(audience)
  const result: ReferralEmailSendResult = {
    attempted: 0,
    suppressed: 0,
    sent: 0,
    unconfigured: 0,
    failed: 0,
  }

  for (const recipient of recipients) {
    if (isReferralEmailSuppressed(recipient.email)) {
      result.suppressed += 1
      continue
    }
    result.attempted += 1

    let composed: RenderedEmail
    try {
      if (input.template === "invite") {
        // Each referrer is invited to share *their own* link.
        const code = getOrCreateReferralCode(recipient.userId).code
        composed = composeReferralInviteEmail({
          recipientEmail: recipient.email,
          ...(recipient.name ? { referrerName: recipient.name } : {}),
          code,
        })
      } else if (input.template === "rewarded") {
        composed = composeReferralRewardEmail({
          recipientEmail: recipient.email,
          ...(recipient.name ? { referrerName: recipient.name } : {}),
        })
      } else {
        composed = composeReferralAnnouncementEmail({ recipientEmail: recipient.email })
      }
    } catch (error) {
      result.failed += 1
      logger.warn(
        {
          event: "referral_email.compose_failed",
          template: input.template,
          recipient: recipient.email,
          error: error instanceof Error ? error.message : String(error),
        },
        "Referral email composition failed for recipient",
      )
      continue
    }

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
          event: "referral_email.send_failed",
          template: input.template,
          recipient: recipient.email,
          error: error instanceof Error ? error.message : String(error),
        },
        "Referral email failed for recipient",
      )
    }
  }

  logger.info(
    {
      event: "referral_email.send_summary",
      template: input.template,
      audience,
      attempted: result.attempted,
      suppressed: result.suppressed,
      sent: result.sent,
      unconfigured: result.unconfigured,
      failed: result.failed,
    },
    "Referral email broadcast completed",
  )

  return result
}
