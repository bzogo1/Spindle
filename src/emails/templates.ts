import { EMAIL_ORIGIN, emailLayout, escapeHtml } from "./layout"

/**
 * Transactional email templates (issue 058).
 *
 * Each template is a pure function returning `{ subject, html, text }`.
 * The HTML rendering uses the shared 600 px layout; the text rendering is
 * written by hand so it reads as a complete message, not stripped markup.
 *
 * Rules enforced here and covered by tests:
 * - The token/link appears only inside the action URL — never in the
 *   subject or surrounding copy.
 * - No remote images, tracking pixels, or third-party link wrapping.
 * - Every interpolated value is HTML-escaped.
 */

export type RenderedEmail = {
  subject: string
  html: string
  text: string
}

/** Renders a real link styled as a button; readable with images blocked. */
function buttonHtml(url: string, label: string): string {
  return `<p style="margin:24px 0;"><a href="${escapeHtml(url)}" style="display:inline-block;background-color:#111827;color:#ffffff;text-decoration:none;font-weight:bold;font-size:15px;padding:12px 24px;border-radius:6px;">${escapeHtml(label)}</a></p>
<p style="margin:0;font-size:13px;color:#5b6472;word-break:break-all;">${escapeHtml(url)}</p>`
}

function paragraph(text: string): string {
  return `<p style="margin:0 0 16px;">${text}</p>`
}

// ---------------------------------------------------------------------------
// Auth link (shared by verify-email and magic-link via `purpose`)
// ---------------------------------------------------------------------------

export type AuthLinkPurpose = "verify-email" | "magic-link"

export function renderAuthLinkEmail(input: {
  purpose: AuthLinkPurpose
  /** Absolute URL containing the single-use token. */
  url: string
  /** Human-readable expiry, e.g. "24 hours" or "15 minutes". */
  expiresIn: string
  unsubscribeUrl?: string
}): RenderedEmail {
  const isVerify = input.purpose === "verify-email"
  const subject = isVerify ? "Verify your Spindle email" : "Your Spindle sign-in link"
  const intro = isVerify
    ? "Confirm your email address to secure your Spindle account."
    : "Sign in to Spindle with the link below."
  const buttonLabel = isVerify ? "Verify email address" : "Sign in to Spindle"
  const expiryNote = isVerify
    ? `This link expires in ${input.expiresIn} and can be used once.`
    : `The link expires in ${input.expiresIn} and can be used once.`
  const ignoreNote = isVerify
    ? "If you did not create this account, ignore this email."
    : "If you did not request this link, ignore this email — your account stays secure."

  const bodyHtml =
    paragraph(escapeHtml(intro)) +
    buttonHtml(input.url, buttonLabel) +
    paragraph(escapeHtml(expiryNote)) +
    paragraph(escapeHtml(ignoreNote))

  const { html, textFooter } = emailLayout({
    preheader: isVerify ? "Confirm your email address" : "Your Spindle sign-in link",
    bodyHtml,
    unsubscribeUrl: input.unsubscribeUrl,
  })

  const text = `${intro}\n\n${input.url}\n\n${expiryNote}\n${ignoreNote}${textFooter}`
  return { subject, html, text }
}

// ---------------------------------------------------------------------------
// Password reset
// ---------------------------------------------------------------------------

export function renderResetPasswordEmail(input: {
  /** Absolute URL containing the single-use reset token. */
  url: string
  /** Human-readable expiry, e.g. "30 minutes". */
  expiresIn?: string
}): RenderedEmail {
  const expiresIn = input.expiresIn ?? "30 minutes"
  const subject = "Reset your Spindle password"
  const intro = "Reset your Spindle password with the link below."
  const expiryNote = `The link expires in ${expiresIn} and can be used once.`
  const ignoreNote =
    "If you did not request a password reset, ignore this email — your password stays unchanged."

  const bodyHtml =
    paragraph(escapeHtml(intro)) +
    buttonHtml(input.url, "Reset password") +
    paragraph(escapeHtml(expiryNote)) +
    paragraph(escapeHtml(ignoreNote))

  const { html, textFooter } = emailLayout({
    preheader: "Reset your Spindle password",
    bodyHtml,
  })

  const text = `${intro}\n\n${input.url}\n\n${expiryNote}\n${ignoreNote}${textFooter}`
  return { subject, html, text }
}

// ---------------------------------------------------------------------------
// Team invitation
// ---------------------------------------------------------------------------

export function renderTeamInviteEmail(input: {
  workspaceName: string
  inviterName: string
  role: string
  /** Absolute URL containing the invite token. */
  url: string
  /** Human-readable expiry, e.g. "7 days". */
  expiresIn?: string
}): RenderedEmail {
  const expiresIn = input.expiresIn ?? "7 days"
  const subject = `${input.inviterName} invited you to ${input.workspaceName} on Spindle`
  const intro = `${input.inviterName} invited you to join the ${input.workspaceName} workspace on Spindle as ${input.role}.`
  const expiryNote = `This invitation expires in ${expiresIn}.`
  const ignoreNote =
    "If you were not expecting this invitation, you can ignore this email — no access is granted until you accept."

  const bodyHtml =
    paragraph(escapeHtml(intro)) +
    buttonHtml(input.url, "Accept invitation") +
    paragraph(escapeHtml(expiryNote)) +
    paragraph(escapeHtml(ignoreNote))

  const { html, textFooter } = emailLayout({
    preheader: `Invitation to ${input.workspaceName} on Spindle`,
    bodyHtml,
  })

  const text = `${intro}\n\n${input.url}\n\n${expiryNote}\n${ignoreNote}${textFooter}`
  return { subject, html, text }
}

// ---------------------------------------------------------------------------
// Invitation reminder
// ---------------------------------------------------------------------------

/**
 * Reminder nudge for a still-pending workspace invitation. Unlike
 * {@link renderTeamInviteEmail} this re-sends the EXISTING accept link —
 * reminders never rotate the token or extend expiry (that is resend's job),
 * so the invitee only ever holds one valid link.
 */
export function renderInvitationReminderEmail(input: {
  workspaceName: string
  inviterName: string
  role?: string
  /** Absolute URL containing the invite token (same link as the original). */
  url: string
  /** Human-readable time left, e.g. "20 hours" or "3 days". */
  expiresIn?: string
}): RenderedEmail {
  const expiresIn = input.expiresIn ?? "the original expiry window"
  const roleNote = input.role ? ` as ${input.role}` : ""
  const subject = `Reminder: your invitation to ${input.workspaceName} on Spindle`
  const intro = `This is a reminder that ${input.inviterName} invited you to join the ${input.workspaceName} workspace on Spindle${roleNote}.`
  const expiryNote = `The invitation expires in ${expiresIn} — the same link from the original email still works.`
  const ignoreNote =
    "If you already accepted or no longer want to join, you can ignore this email. To decline permanently, ask ${input.inviterName} to revoke the invitation."

  const bodyHtml =
    paragraph(escapeHtml(intro)) +
    buttonHtml(input.url, "Accept invitation") +
    paragraph(escapeHtml(expiryNote)) +
    paragraph(escapeHtml(ignoreNote))

  const { html, textFooter } = emailLayout({
    preheader: `Reminder: invitation to ${input.workspaceName} expires soon`,
    bodyHtml,
  })

  const text = `${intro}\n\n${input.url}\n\n${expiryNote}\n${ignoreNote}${textFooter}`
  return { subject, html, text }
}

// ---------------------------------------------------------------------------
// Welcome
// ---------------------------------------------------------------------------

export function renderWelcomeEmail(input: {
  /** Optional recipient name for personalization. */
  name?: string
  /** Absolute URL of the app/dashboard; defaults to the app root. */
  url?: string
}): RenderedEmail {
  const greeting = input.name ? `Hi ${input.name},` : "Hi,"
  const url = input.url ?? `${EMAIL_ORIGIN}/app`
  const subject = "Welcome to Spindle"
  const intro = "Your Spindle account is ready. Welcome aboard!"
  const nextSteps =
    "Here's a quick place to start: create a workspace, invite your team, and connect your first automation."
  const docsNote = `New here? The docs at ${EMAIL_ORIGIN}/docs walk through setup step by step.`
  const closing = "If you did not create this account, you can ignore this email."

  const bodyHtml =
    paragraph(escapeHtml(greeting)) +
    paragraph(escapeHtml(intro)) +
    paragraph(escapeHtml(nextSteps)) +
    buttonHtml(url, "Open Spindle") +
    paragraph(escapeHtml(docsNote)) +
    paragraph(escapeHtml(closing))

  const { html, textFooter } = emailLayout({
    preheader: "Your Spindle account is ready",
    bodyHtml,
  })

  const text = `${greeting}\n\n${intro}\n\n${nextSteps}\n\n${url}\n\n${docsNote}\n\n${closing}${textFooter}`
  return { subject, html, text }
}

// ---------------------------------------------------------------------------
// Feedback received
// ---------------------------------------------------------------------------

export function renderFeedbackReceivedEmail(input: {
  /** Optional recipient name for personalization. */
  name?: string
  /** Optional absolute link to the feedback tracker or docs. */
  url?: string
}): RenderedEmail {
  const greeting = input.name ? `Hi ${input.name},` : "Hi,"
  const subject = "We received your feedback — Spindle"
  const intro =
    "Thanks for sending feedback to the Spindle team. We read every message and use it to shape what we build next."
  const nextSteps =
    "If your feedback describes a problem or a feature request, we'll follow up by email if we need more detail."
  const closing = "You don't need to do anything else — no reply is required."

  const bodyHtml =
    paragraph(escapeHtml(greeting)) +
    paragraph(escapeHtml(intro)) +
    paragraph(escapeHtml(nextSteps)) +
    (input.url ? buttonHtml(input.url, "Visit Spindle") : "") +
    paragraph(escapeHtml(closing))

  const { html, textFooter } = emailLayout({
    preheader: "We received your feedback",
    bodyHtml,
  })

  const text = `${greeting}\n\n${intro}\n\n${nextSteps}${input.url ? `\n\n${input.url}` : ""}\n\n${closing}${textFooter}`
  return { subject, html, text }
}

// ---------------------------------------------------------------------------
// Security alert
// ---------------------------------------------------------------------------

export function renderSecurityAlertEmail(input: {
  /** Short headline describing what happened, e.g. "New sign-in detected". */
  event?: string
  /** Optional extra context, e.g. device, location, or IP summary. */
  details?: string
  /** Absolute URL of the security settings page; defaults to the app route. */
  url?: string
}): RenderedEmail {
  const event = input.event ?? "Security-relevant activity"
  const url = input.url ?? `${EMAIL_ORIGIN}/app/account/security`
  const subject = `Security alert: ${event}`
  const intro = `We detected the following activity on your Spindle account: ${event}.`
  const detailsNote = input.details ? `Details: ${input.details}` : ""
  const actionNote =
    "If you don't recognize this activity, review your account security settings and change your password immediately."

  const bodyHtml =
    paragraph(escapeHtml(intro)) +
    (input.details ? paragraph(escapeHtml(detailsNote)) : "") +
    buttonHtml(url, "Review security settings") +
    paragraph(escapeHtml(actionNote))

  const { html, textFooter } = emailLayout({
    preheader: `Security alert: ${event}`,
    bodyHtml,
  })

  const text = `${intro}${input.details ? `\n\n${detailsNote}` : ""}\n\n${url}\n\n${actionNote}${textFooter}`
  return { subject, html, text }
}

// ---------------------------------------------------------------------------
// Contact form auto-reply
// ---------------------------------------------------------------------------

export function renderContactAutoReplyEmail(input: {
  /** Optional visitor name for personalization. */
  name?: string
  /** Optional absolute link back to the site/contact page. */
  url?: string
}): RenderedEmail {
  const greeting = input.name ? `Hi ${input.name},` : "Hi,"
  const subject = "We received your message — Spindle"
  const intro =
    "Thanks for contacting Spindle. We got your message and a member of the team will reply within two business days."
  const nextSteps = `In the meantime, you can browse the docs at ${EMAIL_ORIGIN}/docs or the security and privacy pages linked below.`
  const closing = "If you did not send this message, you can ignore this email."

  const bodyHtml =
    paragraph(escapeHtml(greeting)) +
    paragraph(escapeHtml(intro)) +
    paragraph(escapeHtml(nextSteps)) +
    (input.url ? buttonHtml(input.url, "Visit Spindle") : "") +
    paragraph(escapeHtml(closing))

  const { html, textFooter } = emailLayout({
    preheader: "We received your message",
    bodyHtml,
  })

  const text = `${greeting}\n\n${intro}\n\n${nextSteps}${input.url ? `\n\n${input.url}` : ""}\n\n${closing}${textFooter}`
  return { subject, html, text }
}

// ---------------------------------------------------------------------------
// Newsletter double opt-in (built but not yet wired — no newsletter flow exists)
// ---------------------------------------------------------------------------

export function renderNewsletterConfirmEmail(input: {
  /** Absolute URL containing the confirmation token. */
  confirmUrl: string
  /** Optional absolute unsubscribe URL for the footer. */
  unsubscribeUrl?: string
}): RenderedEmail {
  const subject = "Confirm your Spindle newsletter subscription"
  const intro =
    "You asked to subscribe to the Spindle newsletter. Confirm your subscription with the link below."
  const note = "If you did not request this, ignore this email — you will not be subscribed."

  const bodyHtml =
    paragraph(escapeHtml(intro)) +
    buttonHtml(input.confirmUrl, "Confirm subscription") +
    paragraph(escapeHtml(note))

  const { html, textFooter } = emailLayout({
    preheader: "Confirm your newsletter subscription",
    bodyHtml,
    unsubscribeUrl: input.unsubscribeUrl,
  })

  const text = `${intro}\n\n${input.confirmUrl}\n\n${note}${textFooter}`
  return { subject, html, text }
}

// ---------------------------------------------------------------------------
// Welcome series (drip onboarding emails)
// ---------------------------------------------------------------------------

/**
 * Steps of the new-user welcome series, in send order. Delays between steps
 * live in `src/lib/email-series.ts`; this union is the template-side key.
 */
export const WELCOME_SERIES_STEPS = ["day-0", "day-3", "day-7", "day-14"] as const
export type WelcomeSeriesStep = (typeof WELCOME_SERIES_STEPS)[number]

type WelcomeSeriesCopy = {
  subject: string
  preheader: string
  /** Body paragraphs after the greeting, in order. */
  paragraphs: string[]
  ctaLabel: string
}

const WELCOME_SERIES_COPY: Record<WelcomeSeriesStep, WelcomeSeriesCopy> = {
  "day-0": {
    subject: "Welcome to Spindle",
    preheader: "Your Spindle account is ready",
    paragraphs: [
      "Your Spindle account is ready. Welcome aboard!",
      "Here's a quick place to start: create a workspace, invite your team, and connect your first automation.",
      `New here? The docs at ${EMAIL_ORIGIN}/docs walk through setup step by step.`,
    ],
    ctaLabel: "Open Spindle",
  },
  "day-3": {
    subject: "Three Spindle tips to try this week",
    preheader: "Get more out of your new account",
    paragraphs: [
      "A few minutes with these and Spindle starts paying for itself:",
      "1. Connect your first automation — pick a template from the gallery and point it at a real workflow.",
      "2. Invite a teammate — shared workspaces keep runs, logs, and secrets in one place.",
      "3. Turn on email digests in notification settings so you only hear about what matters.",
    ],
    ctaLabel: "Explore the gallery",
  },
  "day-7": {
    subject: "Your first-week Spindle checklist",
    preheader: "A quick checklist for week one",
    paragraphs: [
      "One week in — here's a short checklist to make sure nothing important slipped:",
      "- Verify your email address (check your inbox for the earlier verification link).",
      "- Create or join a workspace and invite at least one teammate.",
      "- Run one automation end-to-end and confirm the output looks right.",
      "- Review account security settings and enable two-factor authentication.",
      "- Skim the changelog — we ship improvements every week.",
    ],
    ctaLabel: "Open your dashboard",
  },
  "day-14": {
    subject: "Ready to get more out of Spindle?",
    preheader: "Ideas for your second week",
    paragraphs: [
      "Two weeks in, most teams are ready for the next level:",
      "- Stack automations — chain outputs from one run into the next.",
      "- Use secrets and environment variables instead of hard-coding credentials.",
      "- Set up a workspace per project so permissions and logs stay clean.",
      "Questions or feature requests? Just reply to this email or use the contact page — we read everything.",
    ],
    ctaLabel: "See what's new",
  },
}

/**
 * Renders one step of the welcome drip series. Unlike one-off transactional
 * templates, `unsubscribeUrl` is required: every message in the series carries
 * the unsubscribe link in the footer, and the caller (`email-series.ts`) is
 * responsible for checking `isUnsubscribed` before sending.
 */
export function renderWelcomeSeriesEmail(input: {
  step: WelcomeSeriesStep
  /** Optional recipient name for personalization. */
  name?: string
  /** Absolute unsubscribe URL — always rendered into the footer. */
  unsubscribeUrl: string
  /** Absolute URL for the primary CTA; defaults to the app root. */
  appUrl?: string
}): RenderedEmail {
  const copy = WELCOME_SERIES_COPY[input.step]
  const greeting = input.name ? `Hi ${input.name},` : "Hi,"
  const url = input.appUrl ?? `${EMAIL_ORIGIN}/app`

  const note =
    "You're receiving this email because you created a Spindle account. You can unsubscribe from the series at any time using the link below."

  const bodyHtml =
    paragraph(escapeHtml(greeting)) +
    copy.paragraphs.map((text) => paragraph(escapeHtml(text))).join("\n") +
    buttonHtml(url, copy.ctaLabel) +
    paragraph(escapeHtml(note))

  const { html, textFooter } = emailLayout({
    preheader: copy.preheader,
    bodyHtml,
    unsubscribeUrl: input.unsubscribeUrl,
  })

  const text = `${greeting}\n\n${copy.paragraphs.join("\n\n")}\n\n${url}\n\n${note}${textFooter}`
  return { subject: copy.subject, html, text }
}

// ---------------------------------------------------------------------------
// Notification digest
// ---------------------------------------------------------------------------

export type NotificationDigestItem = {
  /** Short headline for the notification. */
  title: string
  /** Optional one-or-two-sentence detail. */
  body?: string
  /** Optional link to the source (absolute or site-relative). */
  href?: string
}

/**
 * Batched summary of in-app notifications, sent on the user's chosen cadence
 * (daily/weekly). Callers are responsible for filtering by the recipient's
 * email preferences and capping the list — this template renders whatever it
 * is given plus an optional `overflowCount` for "+N more" copy.
 */
export function renderNotificationDigestEmail(input: {
  frequency: "daily" | "weekly"
  items: NotificationDigestItem[]
  /** Notifications matching the digest that were omitted from `items`. */
  overflowCount?: number
  /** Absolute URL of the notifications page; defaults to the app route. */
  notificationsUrl?: string
}): RenderedEmail {
  const period = input.frequency === "daily" ? "day" : "week"
  const count = input.items.length + (input.overflowCount ?? 0)
  const plural = count === 1 ? "notification" : "notifications"
  const subject = `Your Spindle ${input.frequency} digest — ${count} ${plural}`
  const intro = `Here's a summary of ${count} ${plural} from the last ${period}.`
  const overflow =
    (input.overflowCount ?? 0) > 0
      ? `…and ${input.overflowCount} more — open the app to see everything.`
      : ""
  const prefsNote =
    "You're receiving this because you enabled email digests. Manage frequency and per-category email settings on the notifications page."

  const notificationsUrl = input.notificationsUrl ?? `${EMAIL_ORIGIN}/app/account/notifications`

  const itemHtml = input.items
    .map((item) => {
      const titleHtml = item.href
        ? `<a href="${escapeHtml(item.href)}" style="color:#111827;font-weight:bold;text-decoration:underline;">${escapeHtml(item.title)}</a>`
        : `<strong style="color:#111827;">${escapeHtml(item.title)}</strong>`
      const bodyHtml = item.body
        ? `<div style="margin:4px 0 0;font-size:14px;color:#374151;">${escapeHtml(item.body)}</div>`
        : ""
      return `<div style="border-left:3px solid #e4e4e7;padding:4px 0 4px 12px;margin:0 0 16px;">${titleHtml}${bodyHtml}</div>`
    })
    .join("\n")

  const overflowHtml = overflow ? paragraph(`<em>${escapeHtml(overflow)}</em>`) : ""

  const bodyHtml =
    paragraph(escapeHtml(intro)) +
    itemHtml +
    overflowHtml +
    buttonHtml(notificationsUrl, "Open notifications") +
    paragraph(escapeHtml(prefsNote))

  const { html, textFooter } = emailLayout({
    preheader: `${count} ${plural} from the last ${period}`,
    bodyHtml,
  })

  const itemText = input.items
    .map((item) => {
      const lines = [`• ${item.title}`]
      if (item.body) lines.push(`  ${item.body}`)
      if (item.href) lines.push(`  ${item.href}`)
      return lines.join("\n")
    })
    .join("\n")

  const textSections = [intro, itemText]
  if (overflow) textSections.push(overflow)
  textSections.push(notificationsUrl, "", prefsNote)
  const text = `${textSections.join("\n\n").replace(/\n{3,}/g, "\n\n")}${textFooter}`

  return { subject, html, text }
}

// ---------------------------------------------------------------------------
// Referral program emails (issue 093)
// ---------------------------------------------------------------------------

/**
 * Referral invite — sent to the *friend* a referrer wants to bring in.
 * Marketing-class mail: `unsubscribeUrl` is rendered into the footer when
 * provided (callers mint it via `unsubscribePageUrl` scope `"marketing"`).
 * The share URL is the only link that attributes; the reward mention is
 * copy only — `rewardLabel` comes from program settings and is optional.
 */
export function renderReferralInviteEmail(input: {
  /** Display name of the person sharing their link; falls back to "a friend". */
  referrerName?: string
  /** Absolute share URL (`/r/<code>` with UTM params). */
  shareUrl: string
  /** Human-readable reward for the referrer, e.g. "A free month of Spindle Pro". */
  rewardLabel?: string | null
  unsubscribeUrl?: string
}): RenderedEmail {
  const sharer = input.referrerName?.trim() || "A friend"
  const subject = `${sharer} invited you to Spindle`
  const intro = `${sharer} thinks you'd like Spindle and shared their personal invite link with you.`
  const rewardNote = input.rewardLabel?.trim()
    ? `As a thank-you, ${sharer} earns a reward when you join: ${input.rewardLabel.trim()}.`
    : ""
  const closing =
    "If you weren't expecting this invitation, you can ignore this email — no account is created and nothing is shared."

  const bodyHtml =
    paragraph(escapeHtml(intro)) +
    (rewardNote ? paragraph(escapeHtml(rewardNote)) : "") +
    buttonHtml(input.shareUrl, "Join Spindle") +
    paragraph(escapeHtml(closing))

  const { html, textFooter } = emailLayout({
    preheader: `${sharer} invited you to Spindle`,
    bodyHtml,
    unsubscribeUrl: input.unsubscribeUrl,
  })

  const text = `${intro}${rewardNote ? `\n\n${rewardNote}` : ""}\n\n${input.shareUrl}\n\n${closing}${textFooter}`
  return { subject, html, text }
}

/**
 * Referral qualified/rewarded notification — sent to the *referrer* when an
 * attribution they own reaches `qualified`/`rewarded`. Although arguably
 * account-related, it is still program marketing copy, so callers pass a
 * `"marketing"`-scoped `unsubscribeUrl` (see `referral-emails.ts`).
 */
export function renderReferralRewardEmail(input: {
  referrerName?: string
  /** Human-readable reward label from program settings; omitted when unset. */
  rewardLabel?: string | null
  /** Absolute URL of the in-app referral screen; defaults to `/app/referral`. */
  appUrl?: string
  unsubscribeUrl?: string
}): RenderedEmail {
  const greeting = input.referrerName?.trim() ? `Hi ${input.referrerName.trim()},` : "Hi,"
  const reward = input.rewardLabel?.trim()
  const rewardNote = reward
    ? `You've earned ${reward}.`
    : "Your referral reward has been recorded on your account."
  const appUrl = input.appUrl ?? `${EMAIL_ORIGIN}/app/referral`
  const closing =
    "Rewards are tracked on your referral dashboard — no action is needed on your side. Keep sharing your link to earn more."

  const bodyHtml =
    paragraph(escapeHtml(greeting)) +
    paragraph(escapeHtml("Good news — someone you invited to Spindle has qualified.")) +
    paragraph(escapeHtml(rewardNote)) +
    buttonHtml(appUrl, "View your referrals") +
    paragraph(escapeHtml(closing))

  const { html, textFooter } = emailLayout({
    preheader: "Your Spindle referral qualified",
    bodyHtml,
    unsubscribeUrl: input.unsubscribeUrl,
  })

  const text = `${greeting}\n\nGood news — someone you invited to Spindle has qualified.\n\n${rewardNote}\n\n${appUrl}\n\n${closing}${textFooter}`
  return { subject: "Your Spindle referral qualified", html, text }
}

/**
 * Referral program announcement — broadcast to program participants
 * (referrers). Marketing-class mail: `unsubscribeUrl` is required by
 * convention and rendered into the footer.
 */
export function renderReferralAnnouncementEmail(input: {
  /** Human-readable reward label from program settings; omitted when unset. */
  rewardLabel?: string | null
  /** Absolute URL for the primary CTA; defaults to the public `/referral` page. */
  ctaUrl?: string
  unsubscribeUrl?: string
}): RenderedEmail {
  const reward = input.rewardLabel?.trim()
  const ctaUrl = input.ctaUrl ?? `${EMAIL_ORIGIN}/referral`
  const intro =
    "The Spindle referral program is officially here: share your personal link and earn rewards when friends you invite join Spindle."
  const rewardNote = reward
    ? `What you earn: ${reward}. Rewards are recorded automatically each time an invitation qualifies.`
    : "Rewards are recorded automatically each time an invitation qualifies — see the referral page for details."
  const howNote =
    "Find your personal share link on your referral dashboard and send it however you like — email, chat, social. There's no limit to how many friends you can invite."
  const closing = "Questions? Just reply to this email or visit the contact page."

  const bodyHtml =
    paragraph(escapeHtml(intro)) +
    paragraph(escapeHtml(rewardNote)) +
    paragraph(escapeHtml(howNote)) +
    buttonHtml(ctaUrl, "Get your referral link") +
    paragraph(escapeHtml(closing))

  const { html, textFooter } = emailLayout({
    preheader: "The Spindle referral program is here",
    bodyHtml,
    unsubscribeUrl: input.unsubscribeUrl,
  })

  const text = `${intro}\n\n${rewardNote}\n\n${howNote}\n\n${ctaUrl}\n\n${closing}${textFooter}`
  return { subject: "The Spindle referral program is here", html, text }
}
