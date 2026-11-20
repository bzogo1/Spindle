import { emailLayout, escapeHtml } from "@/emails"
import {
  formatReleaseDate,
  getReleaseUrl,
  type ChangelogBlock,
  type ChangelogRelease,
} from "@/lib/changelog"

/**
 * Composes the release-notes email sent from `/app/admin/release-notes`.
 *
 * Pure function: given changelog entries (from `src/lib/changelog.ts`) and an
 * optional recipient name, returns `{ subject, text, html }` ready for
 * `sendEmail`. Every interpolated value is HTML-escaped via `escapeHtml` —
 * entry content is admin-authored but still untrusted markup-wise, and the
 * same escaping keeps the preview endpoint honest about what ships.
 *
 * The HTML rendering uses the shared 600 px email layout (`src/emails`), so
 * the message inherits the same constraints as transactional mail: inline
 * styles, no remote images, text-safe footer. When `options.unsubscribeUrl`
 * is provided (send path only — the admin preview has no recipient address
 * to mint a token for), the layout appends an Unsubscribe link to the HTML
 * footer and the plain-text footer.
 */

export type ReleaseNotesEmail = {
  subject: string
  text: string
  html: string
}

const EMPTY_BODY_HTML =
  '<p style="margin:0 0 16px;">There are no published release notes yet. Check back soon.</p>'
const EMPTY_BODY_TEXT = "There are no published release notes yet. Check back soon."

function blockHtml(block: ChangelogBlock): string {
  if (block.type === "paragraph") {
    return `<p style="margin:0 0 16px;">${escapeHtml(block.text)}</p>`
  }
  const items = block.items
    .map(
      (item) =>
        `<li style="margin:0 0 8px;"><strong>${escapeHtml(item.label)}:</strong> ${escapeHtml(item.text)}</li>`,
    )
    .join("")
  return `<ul style="margin:0 0 16px;padding-left:20px;">${items}</ul>`
}

function blockText(block: ChangelogBlock): string {
  if (block.type === "paragraph") return block.text
  return block.items.map((item) => `- ${item.label}: ${item.text}`).join("\n")
}

function entryHtml(entry: ChangelogRelease): string {
  const blocks = entry.body.map(blockHtml).join("\n")
  return `<h2 style="margin:0 0 4px;font-size:18px;color:#111827;">${escapeHtml(entry.version)} — ${escapeHtml(entry.title)}</h2>
<p style="margin:0 0 12px;font-size:13px;color:#5b6472;">${escapeHtml(formatReleaseDate(entry.date))}</p>
<p style="margin:0 0 16px;">${escapeHtml(entry.summary)}</p>
<p style="margin:0 0 16px;"><a href="${escapeHtml(getReleaseUrl(entry))}" style="color:#111827;">Read the full release notes</a></p>
${blocks || EMPTY_BODY_HTML}
<hr style="border:none;border-top:1px solid #e4e4e7;margin:24px 0 16px;">`
}

function entryText(entry: ChangelogRelease): string {
  const blocks = entry.body.map(blockText).join("\n\n")
  return `${entry.version} — ${entry.title}
${formatReleaseDate(entry.date)}

${entry.summary}

${blocks || EMPTY_BODY_TEXT}

Full notes: ${getReleaseUrl(entry)}
`
}

export function composeReleaseNotesEmail(
  entries: ChangelogRelease[],
  options: { userName?: string; unsubscribeUrl?: string } = {},
): ReleaseNotesEmail {
  const userName = options.userName?.trim()
  const subject =
    entries.length === 1
      ? entries[0]!.title
      : entries.length > 1
        ? `Spindle release notes (${entries.length} updates)`
        : "Spindle release notes"

  const greetingHtml = userName
    ? `<p style="margin:0 0 16px;">Hi ${escapeHtml(userName)},</p>`
    : `<p style="margin:0 0 16px;">Hi there,</p>`
  const greetingText = userName ? `Hi ${userName},` : "Hi there,"

  const introHtml =
    entries.length === 1
      ? ""
      : '<p style="margin:0 0 16px;">Here is what shipped since your last update.</p>'
  const introText = entries.length === 1 ? "" : "Here is what shipped since your last update.\n\n"

  if (entries.length === 0) {
    const bodyHtml = `${greetingHtml}${EMPTY_BODY_HTML}`
    const { html, textFooter } = emailLayout({
      preheader: subject,
      bodyHtml,
      ...(options.unsubscribeUrl ? { unsubscribeUrl: options.unsubscribeUrl } : {}),
    })
    return { subject, html, text: `${greetingText}\n\n${EMPTY_BODY_TEXT}${textFooter}` }
  }

  const bodyHtml = `${greetingHtml}${introHtml}${entries.map(entryHtml).join("\n")}`
  const bodyText = `${greetingText}\n\n${introText}${entries.map(entryText).join("\n---\n\n")}`

  const { html, textFooter } = emailLayout({
    preheader: subject,
    bodyHtml,
    ...(options.unsubscribeUrl ? { unsubscribeUrl: options.unsubscribeUrl } : {}),
  })

  return {
    subject,
    html,
    text: `${bodyText}${textFooter}`,
  }
}
