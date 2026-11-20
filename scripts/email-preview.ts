/**
 * Renders every transactional email template to static files for local review.
 *
 * Usage:
 *   npm run email:preview        # or: tsx scripts/email-preview.ts
 *
 * Output: .email-preview/<template>.html (+ .txt and an index.html).
 * The directory is gitignored — open the HTML files in a browser to review.
 *
 * The script discovers every `render*Email` export from src/emails and feeds
 * it sample props. Templates whose props can't be guessed, or that throw,
 * are skipped with a warning so the preview stays useful while templates
 * evolve.
 */

import { mkdir, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"

import * as emailTemplates from "../src/emails/index"

type RenderedEmail = { subject: string; html: string; text: string }
type RenderFn = (props: Record<string, unknown>) => RenderedEmail

const PREVIEW_DIR = resolve(process.cwd(), ".email-preview")
const PREVIEW_ORIGIN = "https://spindle.example"

const SAMPLE_URL = `${PREVIEW_ORIGIN}/auth/verify?token=preview-token`

/**
 * Sample props per template export name. Keys not consumed by a template are
 * ignored at runtime; missing required values degrade to "undefined" in the
 * output, which is fine for a visual preview.
 */
const SAMPLE_PROPS: Record<string, Record<string, unknown>> = {
  renderAuthLinkEmail: {
    purpose: "verify-email",
    url: SAMPLE_URL,
    expiresIn: "24 hours",
  },
  renderResetPasswordEmail: {
    url: `${PREVIEW_ORIGIN}/auth/reset?token=preview-token`,
    expiresIn: "30 minutes",
  },
  renderTeamInviteEmail: {
    workspaceName: "Acme Corp",
    inviterName: "Ada Lovelace",
    role: "admin",
    url: `${PREVIEW_ORIGIN}/invite/accept?token=preview-token`,
    expiresIn: "7 days",
  },
  renderContactAutoReplyEmail: {
    name: "Grace Hopper",
    url: `${PREVIEW_ORIGIN}/contact`,
  },
  renderNewsletterConfirmEmail: {
    confirmUrl: `${PREVIEW_ORIGIN}/newsletter/confirm?token=preview-token`,
    unsubscribeUrl: `${PREVIEW_ORIGIN}/newsletter/unsubscribe?token=preview-token`,
  },
  renderNotificationDigestEmail: {
    frequency: "weekly",
    items: [
      {
        title: "Agent run finished",
        body: "Your nightly digest automation completed with 3 new matches.",
        href: `${PREVIEW_ORIGIN}/app/automations`,
      },
      {
        title: "Security alert: new sign-in",
        body: "A new device signed in to your account from a recognized location.",
        href: `${PREVIEW_ORIGIN}/app/account/security`,
      },
      { title: "Lab snapshot ready", body: "Baseline comparison finished." },
    ],
    overflowCount: 4,
  },
}

/** Generic prop bag for render*Email exports without an explicit entry. */
const GENERIC_PROPS: Record<string, unknown> = {
  url: SAMPLE_URL,
  confirmUrl: SAMPLE_URL,
  unsubscribeUrl: `${PREVIEW_ORIGIN}/unsubscribe?token=preview-token`,
  expiresIn: "24 hours",
  name: "Preview User",
  inviterName: "Preview Sender",
  workspaceName: "Preview Workspace",
  role: "member",
  purpose: "verify-email",
}

function slugify(name: string): string {
  return name
    .replace(/^render/, "")
    .replace(/Email$/, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase()
}

async function main(): Promise<number> {
  const exports = emailTemplates as Record<string, unknown>
  const renderNames = Object.keys(exports)
    .filter((key) => /^render\w+Email$/.test(key))
    .sort()

  if (renderNames.length === 0) {
    console.error("No render*Email exports found in src/emails — nothing to preview.")
    return 1
  }

  await mkdir(PREVIEW_DIR, { recursive: true })

  const rendered: { slug: string; subject: string }[] = []
  let skipped = 0

  for (const name of renderNames) {
    const fn = exports[name]
    if (typeof fn !== "function") {
      console.warn(`skip ${name}: export is not a function`)
      skipped++
      continue
    }

    const props = SAMPLE_PROPS[name] ?? GENERIC_PROPS
    try {
      const result = (fn as RenderFn)(props)
      if (!result || typeof result.html !== "string") {
        console.warn(`skip ${name}: render did not return { subject, html, text }`)
        skipped++
        continue
      }
      const slug = slugify(name)
      await writeFile(join(PREVIEW_DIR, `${slug}.html`), result.html, "utf8")
      await writeFile(join(PREVIEW_DIR, `${slug}.txt`), result.text, "utf8")
      rendered.push({ slug, subject: result.subject })
      console.log(`wrote ${slug}.html — "${result.subject}"`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.warn(`skip ${name}: ${message}`)
      skipped++
    }
  }

  if (rendered.length === 0) {
    console.error("No templates rendered successfully.")
    return 1
  }

  const indexHtml = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Email previews</title>
<style>
  body{font-family:Arial,Helvetica,sans-serif;max-width:640px;margin:32px auto;padding:0 16px;color:#1f2937}
  li{margin:8px 0}
  a{color:#111827}
</style>
</head>
<body>
<h1>Email previews</h1>
<p>${rendered.length} template(s) rendered, ${skipped} skipped. Regenerate with <code>npm run email:preview</code>.</p>
<ul>
${rendered.map((r) => `  <li><a href="./${r.slug}.html">${r.slug}</a> — ${escapeIndex(r.subject)}</li>`).join("\n")}
</ul>
</body>
</html>
`
  await writeFile(join(PREVIEW_DIR, "index.html"), indexHtml, "utf8")

  console.log(`\n${rendered.length} preview(s) written to ${PREVIEW_DIR}`)
  if (skipped > 0) console.log(`${skipped} template(s) skipped.`)
  return 0
}

function escapeIndex(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch] ?? ch,
  )
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(2)
  })
