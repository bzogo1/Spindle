import { describe, expect, it } from "vitest"

import { EMAIL_ORIGIN, escapeHtml, emailLayout } from "./layout"
import {
  renderAuthLinkEmail,
  renderContactAutoReplyEmail,
  renderFeedbackReceivedEmail,
  renderInvitationReminderEmail,
  renderNewsletterConfirmEmail,
  renderNotificationDigestEmail,
  renderResetPasswordEmail,
  renderSecurityAlertEmail,
  renderTeamInviteEmail,
  renderWelcomeEmail,
  renderWelcomeSeriesEmail,
  WELCOME_SERIES_STEPS,
} from "./templates"

const VERIFY_URL = "https://spindle.example/verify-email?token=tok_verify_123"
const MAGIC_URL = "https://spindle.example/magic-link?token=tok_magic_123"
const RESET_URL = "https://spindle.example/reset-password/tok_reset_123"

const ALL_RENDERERS = [
  () =>
    renderAuthLinkEmail({
      purpose: "verify-email",
      url: VERIFY_URL,
      expiresIn: "24 hours",
    }),
  () =>
    renderAuthLinkEmail({
      purpose: "magic-link",
      url: MAGIC_URL,
      expiresIn: "15 minutes",
    }),
  () => renderResetPasswordEmail({ url: RESET_URL }),
  () =>
    renderTeamInviteEmail({
      workspaceName: "Lab",
      inviterName: "Ada",
      role: "editor",
      url: "https://spindle.example/invite/tok_invite",
    }),
  () =>
    renderInvitationReminderEmail({
      workspaceName: "Lab",
      inviterName: "Ada",
      role: "editor",
      url: "https://spindle.example/invite/tok_invite",
      expiresIn: "20 hours",
    }),
  () => renderContactAutoReplyEmail({ name: "Grace", url: "https://spindle.example/contact" }),
  () => renderWelcomeEmail({ name: "Ada" }),
  ...WELCOME_SERIES_STEPS.map(
    (step) => () =>
      renderWelcomeSeriesEmail({
        step,
        name: "Ada",
        unsubscribeUrl: "https://spindle.example/unsubscribe?token=t",
      }),
  ),
  () => renderFeedbackReceivedEmail({ name: "Grace", url: "https://spindle.example/feedback" }),
  () =>
    renderSecurityAlertEmail({
      event: "New sign-in detected",
      details: "Chrome on macOS, Lisbon, Portugal",
      url: "https://spindle.example/app/account/security",
    }),
  () =>
    renderNewsletterConfirmEmail({
      confirmUrl: "https://spindle.example/newsletter/confirm/tok_news",
      unsubscribeUrl: "https://spindle.example/newsletter/unsubscribe/tok_news",
    }),
  () =>
    renderNotificationDigestEmail({
      frequency: "weekly",
      items: [
        { title: "Run finished", body: "3 matches", href: "https://spindle.example/app/runs/1" },
        { title: "New sign-in" },
      ],
      overflowCount: 2,
    }),
]

describe("escapeHtml", () => {
  it("escapes quotes, angle brackets, and ampersands", () => {
    expect(escapeHtml(`<a href="x">&'</a>`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;",
    )
  })
})

describe("emailLayout", () => {
  it("renders a 600px table layout with brand text and footer links", () => {
    const { html, textFooter } = emailLayout({
      bodyHtml: "<p>Hello</p>",
      unsubscribeUrl: "https://spindle.example/newsletter/unsubscribe/tok",
    })
    expect(html).toContain("max-width:600px")
    expect(html).toContain(">Spindle<")
    expect(html).toContain("/privacy")
    expect(html).toContain("/terms")
    expect(html).toContain("/security")
    expect(html).toContain("/contact")
    expect(textFooter).toContain("Privacy: http")
    expect(textFooter).toContain("Unsubscribe: https://spindle.example/newsletter/unsubscribe/tok")
  })
})

describe("renderAuthLinkEmail", () => {
  it("renders verify-email copy with the link in html and text", () => {
    const email = renderAuthLinkEmail({
      purpose: "verify-email",
      url: VERIFY_URL,
      expiresIn: "24 hours",
    })
    expect(email.subject).toBe("Verify your Spindle email")
    expect(email.html).toContain(`href="${VERIFY_URL}"`)
    expect(email.text).toContain(VERIFY_URL)
    expect(email.html).toContain("24 hours")
    expect(email.text).toContain("24 hours")
  })

  it("renders magic-link copy distinctly from verify-email", () => {
    const email = renderAuthLinkEmail({
      purpose: "magic-link",
      url: MAGIC_URL,
      expiresIn: "15 minutes",
    })
    expect(email.subject).toBe("Your Spindle sign-in link")
    expect(email.html).toContain(`href="${MAGIC_URL}"`)
    expect(email.text).toContain(MAGIC_URL)
    expect(email.html).toContain("15 minutes")
  })
})

describe("renderResetPasswordEmail", () => {
  it("includes the reset link, single-use expiry, and no password copy", () => {
    const email = renderResetPasswordEmail({ url: RESET_URL })
    expect(email.subject).toBe("Reset your Spindle password")
    expect(email.html).toContain(`href="${RESET_URL}"`)
    expect(email.text).toContain(RESET_URL)
    expect(email.html).toContain("30 minutes")
    expect(email.text).toContain("used once")
    expect(email.text.toLowerCase()).not.toContain("your new password is")
  })
})

describe("renderTeamInviteEmail", () => {
  it("includes workspace, inviter, role, link, and expiry", () => {
    const email = renderTeamInviteEmail({
      workspaceName: "Lab",
      inviterName: "Ada",
      role: "editor",
      url: "https://spindle.example/invite/tok_invite",
      expiresIn: "7 days",
    })
    expect(email.subject).toContain("Ada")
    expect(email.subject).toContain("Lab")
    expect(email.html).toContain("Lab")
    expect(email.html).toContain("editor")
    expect(email.html).toContain("7 days")
    expect(email.text).toContain("https://spindle.example/invite/tok_invite")
  })
})

describe("renderInvitationReminderEmail", () => {
  it("includes workspace, inviter, role, link, and time left", () => {
    const email = renderInvitationReminderEmail({
      workspaceName: "Lab",
      inviterName: "Ada",
      role: "editor",
      url: "https://spindle.example/invite/tok_invite",
      expiresIn: "20 hours",
    })
    expect(email.subject).toContain("Reminder")
    expect(email.subject).toContain("Lab")
    expect(email.html).toContain("Lab")
    expect(email.html).toContain("editor")
    expect(email.html).toContain("20 hours")
    expect(email.text).toContain("https://spindle.example/invite/tok_invite")
  })

  it("renders without optional role/expiresIn and escapes interpolated values", () => {
    const email = renderInvitationReminderEmail({
      workspaceName: "<b>Lab</b>",
      inviterName: "Ada & Co",
      url: "https://spindle.example/invite/tok",
    })
    expect(email.html).not.toContain("<b>Lab</b>")
    expect(email.html).toContain("&lt;b&gt;Lab&lt;/b&gt;")
    expect(email.text).toContain("Ada & Co")
  })
})

describe("renderWelcomeEmail", () => {
  it("greets the recipient, links to the app, and points at the docs", () => {
    const email = renderWelcomeEmail({ name: "Ada" })
    expect(email.subject).toBe("Welcome to Spindle")
    expect(email.html).toContain("Hi Ada")
    expect(email.text).toContain("Hi Ada")
    expect(email.html).toContain(`${EMAIL_ORIGIN}/app`)
    expect(email.text).toContain(`${EMAIL_ORIGIN}/docs`)
  })

  it("renders without a name or custom url", () => {
    const email = renderWelcomeEmail({})
    expect(email.html).toContain("Hi,")
    expect(email.html).toContain(`${EMAIL_ORIGIN}/app`)
  })
})

describe("renderWelcomeSeriesEmail", () => {
  const UNSUB = "https://spindle.example/unsubscribe?token=tok_unsub"

  it("renders every step with subject, html, and text", () => {
    for (const step of WELCOME_SERIES_STEPS) {
      const email = renderWelcomeSeriesEmail({ step, name: "Ada", unsubscribeUrl: UNSUB })
      expect(email.subject.length).toBeGreaterThan(0)
      expect(email.html).toContain("<html")
      expect(email.text.length).toBeGreaterThan(0)
    }
  })

  it("includes the unsubscribe link in html and text for every step", () => {
    for (const step of WELCOME_SERIES_STEPS) {
      const email = renderWelcomeSeriesEmail({ step, unsubscribeUrl: UNSUB })
      expect(email.html).toContain(`href="${UNSUB}"`)
      expect(email.text).toContain(`Unsubscribe: ${UNSUB}`)
    }
  })

  it("has distinct subjects per step", () => {
    const subjects = WELCOME_SERIES_STEPS.map(
      (step) => renderWelcomeSeriesEmail({ step, unsubscribeUrl: UNSUB }).subject,
    )
    expect(new Set(subjects).size).toBe(WELCOME_SERIES_STEPS.length)
  })

  it("greets by name and links the CTA to the app", () => {
    const email = renderWelcomeSeriesEmail({
      step: "day-3",
      name: "Ada",
      unsubscribeUrl: UNSUB,
      appUrl: "https://spindle.example/app",
    })
    expect(email.html).toContain("Hi Ada,")
    expect(email.html).toContain('href="https://spindle.example/app"')
    expect(email.text).toContain("Hi Ada,")
  })

  it("escapes hostile names", () => {
    const email = renderWelcomeSeriesEmail({
      step: "day-0",
      name: "<img src=x onerror=alert(1)>",
      unsubscribeUrl: UNSUB,
    })
    expect(email.html).not.toContain("<img src=x")
    expect(email.html).toContain("&lt;img")
  })
})

describe("renderFeedbackReceivedEmail", () => {
  it("confirms receipt and thanks the sender", () => {
    const email = renderFeedbackReceivedEmail({ name: "Grace" })
    expect(email.subject).toBe("We received your feedback — Spindle")
    expect(email.html).toContain("Hi Grace")
    expect(email.text).toContain("read every message")
    expect(email.text).toContain("no reply is required")
  })

  it("includes the optional url when provided", () => {
    const email = renderFeedbackReceivedEmail({
      url: "https://spindle.example/feedback",
    })
    expect(email.html).toContain('href="https://spindle.example/feedback"')
    expect(email.text).toContain("https://spindle.example/feedback")
  })
})

describe("renderSecurityAlertEmail", () => {
  it("includes the event, details, and a security settings link", () => {
    const email = renderSecurityAlertEmail({
      event: "New sign-in detected",
      details: "Chrome on macOS, Lisbon, Portugal",
      url: "https://spindle.example/app/account/security",
    })
    expect(email.subject).toBe("Security alert: New sign-in detected")
    expect(email.html).toContain("New sign-in detected")
    expect(email.html).toContain("Chrome on macOS")
    expect(email.html).toContain('href="https://spindle.example/app/account/security"')
    expect(email.text).toContain("New sign-in detected")
    expect(email.text).toContain("Chrome on macOS")
    expect(email.text).toContain("https://spindle.example/app/account/security")
  })

  it("falls back to a default event and security settings url", () => {
    const email = renderSecurityAlertEmail({})
    expect(email.subject).toBe("Security alert: Security-relevant activity")
    expect(email.html).toContain(`${EMAIL_ORIGIN}/app/account/security`)
    expect(email.html).not.toContain("Details:")
  })

  it("escapes hostile event and details copy", () => {
    const email = renderSecurityAlertEmail({
      event: "<img src=x onerror=alert(1)>",
      details: '"><script>alert(1)</script>',
    })
    expect(email.html).not.toContain("<img src=x")
    expect(email.html).not.toContain("<script>")
    expect(email.html).toContain("&lt;img")
    expect(email.html).toContain("&quot;&gt;&lt;script&gt;")
  })
})

describe("renderContactAutoReplyEmail", () => {
  it("greets the visitor and states the response window", () => {
    const email = renderContactAutoReplyEmail({ name: "Grace" })
    expect(email.html).toContain("Hi Grace")
    expect(email.text).toContain("Hi Grace")
    expect(email.text).toContain("two business days")
  })

  it("links to the docs at the configured site origin, not a placeholder", () => {
    const email = renderContactAutoReplyEmail({})
    expect(email.text).toContain(`${EMAIL_ORIGIN}/docs`)
    expect(email.html).toContain(`${EMAIL_ORIGIN}/docs`)
    expect(email.html).not.toContain("spindle.example/docs")
    expect(email.text).not.toContain("spindle.example/docs")
  })
})

describe("renderNewsletterConfirmEmail", () => {
  it("includes the confirm link and an unsubscribe footer link", () => {
    const email = renderNewsletterConfirmEmail({
      confirmUrl: "https://spindle.example/newsletter/confirm/tok_news",
      unsubscribeUrl: "https://spindle.example/newsletter/unsubscribe/tok_news",
    })
    expect(email.html).toContain('href="https://spindle.example/newsletter/confirm/tok_news"')
    expect(email.html).toContain("newsletter/unsubscribe/tok_news")
    expect(email.text).toContain("Unsubscribe")
  })
})

describe("renderNotificationDigestEmail", () => {
  it("lists items with links, overflow copy, and a notifications CTA", () => {
    const email = renderNotificationDigestEmail({
      frequency: "weekly",
      items: [
        { title: "Run finished", body: "3 matches", href: "https://spindle.example/app/runs/1" },
        { title: "New sign-in" },
      ],
      overflowCount: 2,
    })
    expect(email.subject).toContain("weekly digest")
    expect(email.subject).toContain("4 notifications")
    expect(email.html).toContain('href="https://spindle.example/app/runs/1"')
    expect(email.html).toContain("Run finished")
    expect(email.html).toContain("3 matches")
    expect(email.html).toContain("and 2 more")
    expect(email.html).toContain("/app/account/notifications")
    expect(email.text).toContain("• Run finished")
    expect(email.text).toContain("https://spindle.example/app/runs/1")
    expect(email.text).toContain("and 2 more")
  })

  it("uses daily copy for the daily cadence", () => {
    const email = renderNotificationDigestEmail({
      frequency: "daily",
      items: [{ title: "One thing" }],
    })
    expect(email.subject).toContain("daily digest")
    expect(email.subject).toContain("1 notification")
    expect(email.html).toContain("last day")
    expect(email.text).toContain("last day")
  })

  it("escapes hostile item titles and hrefs", () => {
    const email = renderNotificationDigestEmail({
      frequency: "daily",
      items: [
        {
          title: "<img src=x onerror=alert(1)>",
          body: '"><script>alert(1)</script>',
          href: 'https://spindle.example/x?a="><b>',
        },
      ],
    })
    expect(email.html).not.toContain("<img src=x")
    expect(email.html).not.toContain("<script>")
    expect(email.html).toContain("&lt;img")
    expect(email.html).toContain("&quot;&gt;&lt;b&gt;")
    expect(email.text).toContain("<img src=x onerror=alert(1)>")
  })
})

describe("escaping and safety", () => {
  const evilUrl = 'https://spindle.example/verify-email?token="><script>alert(1)</script>&x=1'

  it("escapes hostile tokens inside href attributes", () => {
    const email = renderAuthLinkEmail({
      purpose: "verify-email",
      url: evilUrl,
      expiresIn: "24 hours",
    })
    expect(email.html).not.toContain("<script>")
    expect(email.html).toContain("&quot;")
    expect(email.html).toContain("&lt;script&gt;")
    // The raw URL still appears verbatim in the plain-text part.
    expect(email.text).toContain(evilUrl)
  })

  it("escapes hostile values in template copy fields", () => {
    const email = renderTeamInviteEmail({
      workspaceName: "<img src=x onerror=alert(1)>",
      inviterName: 'Ada "The Admin"',
      role: "editor",
      url: "https://spindle.example/invite/tok",
    })
    expect(email.html).not.toContain("<img src=x")
    expect(email.html).toContain("&lt;img")
    expect(email.html).toContain("&quot;The Admin&quot;")
  })

  it("contains no tracking pixels or remote images in any template", () => {
    for (const render of ALL_RENDERERS) {
      const { html } = render()
      expect(html).not.toMatch(/<img/i)
      expect(html).not.toMatch(/\.png|\.gif|\.jpg|\.jpeg|\.webp/i)
      expect(html.toLowerCase()).not.toContain("track")
      expect(html.toLowerCase()).not.toContain("pixel")
    }
  })

  it("never puts the token in the subject line", () => {
    const token = "SECRET_TOKEN_abc123"
    const url = `https://spindle.example/reset-password/${token}`
    const email = renderResetPasswordEmail({ url })
    expect(email.subject).not.toContain(token)
    expect(email.subject).not.toContain("http")
  })
})
