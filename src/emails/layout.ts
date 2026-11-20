import { siteUrl } from "@/lib/site-url"

/**
 * Shared HTML layout for transactional email templates.
 *
 * Deliberately dependency-free: templates are plain template literals so the
 * module stays server- and test-safe without pulling a renderer into the
 * bundle. All interpolated values must pass through `escapeHtml`.
 *
 * Constraints (issue 058):
 * - 600 px max width, inline styles only, no remote images or fonts.
 * - Light-safe palette that stays readable in dark-mode clients (explicit
 *   background and text colors, no reliance on inherited colors).
 * - Brand mark is text, not an image, so it survives blocked images.
 * - No tracking pixels or link wrapping anywhere.
 */

export const EMAIL_ORIGIN = siteUrl

const escapeReplacements: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
}

/** Escapes a value for safe interpolation into HTML text or attributes. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => escapeReplacements[ch] ?? ch)
}

export type EmailFooterLink = { label: string; path: string }

/** Legal/support footer links rendered in every template. */
export const EMAIL_FOOTER_LINKS: EmailFooterLink[] = [
  { label: "Privacy", path: "/privacy" },
  { label: "Terms", path: "/terms" },
  { label: "Security", path: "/security" },
  { label: "Contact", path: "/contact" },
]

export type EmailLayoutInput = {
  /** Inbox preview text; hidden in the rendered message. */
  preheader?: string
  /** Rendered HTML body content (already escaped where needed). */
  bodyHtml: string
  /** Optional unsubscribe URL appended to the footer (newsletter flows). */
  unsubscribeUrl?: string
}

function absoluteUrl(pathOrUrl: string, origin: string): string {
  return /^https?:\/\//i.test(pathOrUrl) ? pathOrUrl : new URL(pathOrUrl, origin).toString()
}

function footerHtml(input: EmailLayoutInput, origin: string): string {
  const links = EMAIL_FOOTER_LINKS.map(
    (link) =>
      `<a href="${escapeHtml(absoluteUrl(link.path, origin))}" style="color:#5b6472;text-decoration:underline;">${escapeHtml(link.label)}</a>`,
  )
  const unsubscribe = input.unsubscribeUrl
    ? ` &middot; <a href="${escapeHtml(absoluteUrl(input.unsubscribeUrl, origin))}" style="color:#5b6472;text-decoration:underline;">Unsubscribe</a>`
    : ""
  return `<tr><td style="padding:24px 32px;border-top:1px solid #e4e4e7;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.6;color:#5b6472;">
  <p style="margin:0 0 8px;">You received this email because you have a Spindle account or requested this message.</p>
  <p style="margin:0;">${links.join(" &middot; ")}${unsubscribe}</p>
</td></tr>`
}

function footerText(input: EmailLayoutInput, origin: string): string {
  const links = EMAIL_FOOTER_LINKS.map((link) => `${link.label}: ${absoluteUrl(link.path, origin)}`)
  if (input.unsubscribeUrl) {
    links.push(`Unsubscribe: ${absoluteUrl(input.unsubscribeUrl, origin)}`)
  }
  return `\n\n---\n${links.join("\n")}`
}

/**
 * Wraps body HTML in the shared 600 px layout. Returns the full HTML document
 * and the matching plain-text footer block (body text is supplied by the
 * template itself).
 */
export function emailLayout(input: EmailLayoutInput): {
  html: string
  textFooter: string
} {
  const origin = EMAIL_ORIGIN
  const preheader = input.preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${escapeHtml(input.preheader)}</div>`
    : ""
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Spindle</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f4f5;">
${preheader}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f5;">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background-color:#ffffff;border:1px solid #e4e4e7;border-radius:8px;">
<tr><td style="padding:24px 32px 8px;font-family:Arial,Helvetica,sans-serif;font-size:18px;font-weight:bold;color:#111827;">Spindle</td></tr>
<tr><td style="padding:8px 32px 24px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#1f2937;">
${input.bodyHtml}
</td></tr>
${footerHtml(input, origin)}
</table>
</td></tr>
</table>
</body>
</html>`
  return { html, textFooter: footerText(input, origin) }
}
