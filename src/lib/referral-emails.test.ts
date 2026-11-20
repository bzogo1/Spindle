import { beforeEach, describe, expect, it } from "vitest"

import { siteUrl } from "@/lib/site-url"
import { clearUnsubscribeStore, isUnsubscribed, unsubscribeAddress } from "@/lib/email-unsubscribe"
import {
  composeReferralAnnouncementEmail,
  composeReferralInviteEmail,
  composeReferralRewardEmail,
  isReferralEmailSuppressed,
  isReferralEmailTemplate,
  REFERRAL_EMAIL_TEMPLATES,
  REFERRAL_EMAIL_UNSUBSCRIBE_SCOPE,
} from "@/lib/referral-emails"
import {
  resetReferralProgramStoreForTests,
  updateReferralProgramSettings,
} from "@/lib/referral-program"

const XSS = '<img src=x onerror="alert(1)">'
const RECIPIENT = "friend@example.com"

beforeEach(() => {
  resetReferralProgramStoreForTests()
  clearUnsubscribeStore()
})

describe("composeReferralInviteEmail", () => {
  it("includes the share URL, reward mention, and unsubscribe link", () => {
    const email = composeReferralInviteEmail({
      recipientEmail: RECIPIENT,
      referrerName: "Ada",
      code: "SPN-ABCD-2345",
    })

    expect(email.subject).toBe("Ada invited you to Spindle")
    expect(email.html).toContain(`${siteUrl}/r/SPN-ABCD-2345`)
    expect(email.text).toContain(`${siteUrl}/r/SPN-ABCD-2345`)
    expect(email.html).toContain("A free month of Spindle Pro")
    expect(email.html).toContain("/unsubscribe?")
    expect(email.text).toContain("Unsubscribe:")
  })

  it("HTML-escapes XSS payloads in the referrer name and reward label", () => {
    updateReferralProgramSettings({ rewardLabel: `Free <script>alert("x")</script> month` })
    const email = composeReferralInviteEmail({
      recipientEmail: RECIPIENT,
      referrerName: XSS,
      code: "SPN-ABCD-2345",
    })

    expect(email.html).not.toContain("<script>")
    expect(email.html).not.toContain("<img src=x")
    expect(email.html).toContain("&lt;script&gt;")
    expect(email.html).toContain("&lt;img src=x")
    // Subject is plain text — the raw name is fine there.
    expect(email.subject).toContain(XSS)
  })

  it("falls back to generic copy when optional inputs are missing", () => {
    updateReferralProgramSettings({ enabled: false })
    const email = composeReferralInviteEmail({
      recipientEmail: RECIPIENT,
      code: "SPN-ABCD-2345",
    })

    expect(email.subject).toBe("A friend invited you to Spindle")
    expect(email.html).toContain("A friend thinks you")
    // Program disabled → no reward mention.
    expect(email.html).not.toContain("earns a reward")
    expect(email.html).toContain("/unsubscribe?")
  })

  it("mints a per-recipient marketing-scoped unsubscribe URL", () => {
    const email = composeReferralInviteEmail({
      recipientEmail: RECIPIENT,
      code: "SPN-ABCD-2345",
    })
    const match = email.html.match(/\/unsubscribe\?[^"']+/)
    expect(match).not.toBeNull()
    // The token payload embeds the recipient + scope (base64url JSON).
    const token = new URL(match![0], siteUrl).searchParams.get("token") ?? ""
    const payload = JSON.parse(Buffer.from(token.split(".")[2], "base64url").toString("utf8"))
    expect(payload.email).toBe(RECIPIENT)
    expect(payload.scope).toBe(REFERRAL_EMAIL_UNSUBSCRIBE_SCOPE)
    expect(REFERRAL_EMAIL_UNSUBSCRIBE_SCOPE).toBe("marketing")
  })
})

describe("composeReferralRewardEmail", () => {
  it("renders subject, body, CTA, and unsubscribe link", () => {
    const email = composeReferralRewardEmail({
      recipientEmail: RECIPIENT,
      referrerName: "Ada",
    })

    expect(email.subject).toBe("Your Spindle referral qualified")
    expect(email.html).toContain("Hi Ada,")
    expect(email.html).toContain("A free month of Spindle Pro")
    expect(email.html).toContain("/app/referral")
    expect(email.html).toContain("/unsubscribe?")
    expect(email.text).toContain("/app/referral")
  })

  it("escapes XSS payloads in the referrer name and reward label", () => {
    updateReferralProgramSettings({ rewardLabel: XSS })
    const email = composeReferralRewardEmail({
      recipientEmail: RECIPIENT,
      referrerName: XSS,
    })

    expect(email.html).not.toContain("<img src=x")
    expect(email.html).toContain("&lt;img src=x")
    expect(email.html).toContain("Hi &lt;img")
  })

  it("uses generic copy when name and reward are absent", () => {
    updateReferralProgramSettings({ enabled: false })
    const email = composeReferralRewardEmail({ recipientEmail: RECIPIENT })

    expect(email.html).toContain("Hi,")
    expect(email.html).toContain("Your referral reward has been recorded")
    expect(email.html).not.toContain("You&#39;ve earned")
  })
})

describe("composeReferralAnnouncementEmail", () => {
  it("renders the announcement with CTA and unsubscribe link", () => {
    const email = composeReferralAnnouncementEmail({ recipientEmail: RECIPIENT })

    expect(email.subject).toBe("The Spindle referral program is here")
    expect(email.html).toContain("The Spindle referral program is officially here")
    expect(email.html).toContain(`${siteUrl}/referral`)
    expect(email.html).toContain("/unsubscribe?")
    expect(email.text).toContain("Unsubscribe:")
  })

  it("escapes an XSS reward label", () => {
    updateReferralProgramSettings({ rewardLabel: XSS })
    const email = composeReferralAnnouncementEmail({ recipientEmail: RECIPIENT })

    expect(email.html).not.toContain("<img src=x")
    expect(email.html).toContain("&lt;img src=x")
  })
})

describe("isReferralEmailSuppressed", () => {
  it("honors marketing, newsletter, and all opt-out scopes", () => {
    expect(isReferralEmailSuppressed(RECIPIENT)).toBe(false)

    unsubscribeAddress(RECIPIENT, "marketing")
    expect(isReferralEmailSuppressed(RECIPIENT)).toBe(true)

    clearUnsubscribeStore()
    unsubscribeAddress(RECIPIENT, "newsletter")
    expect(isReferralEmailSuppressed(RECIPIENT)).toBe(true)

    clearUnsubscribeStore()
    unsubscribeAddress(RECIPIENT, "all")
    expect(isReferralEmailSuppressed(RECIPIENT)).toBe(true)
    expect(isUnsubscribed(RECIPIENT, "marketing")).toBe(true)
  })
})

describe("template registry", () => {
  it("exposes the three referral templates", () => {
    expect(REFERRAL_EMAIL_TEMPLATES).toEqual(["invite", "rewarded", "announcement"])
    for (const template of REFERRAL_EMAIL_TEMPLATES) {
      expect(isReferralEmailTemplate(template)).toBe(true)
    }
    expect(isReferralEmailTemplate("bogus")).toBe(false)
  })
})
