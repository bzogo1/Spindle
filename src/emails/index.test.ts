import { describe, expect, it } from "vitest"

import * as emails from "./index"
import { WELCOME_SERIES_STEPS } from "./templates"

describe("emails barrel", () => {
  it("re-exports the welcome-series template and step list", () => {
    expect(typeof emails.renderWelcomeSeriesEmail).toBe("function")
    expect(emails.WELCOME_SERIES_STEPS).toEqual(WELCOME_SERIES_STEPS)
  })

  it("re-exports the pre-existing renderers", () => {
    for (const name of [
      "renderAuthLinkEmail",
      "renderContactAutoReplyEmail",
      "renderFeedbackReceivedEmail",
      "renderInvitationReminderEmail",
      "renderNewsletterConfirmEmail",
      "renderNotificationDigestEmail",
      "renderResetPasswordEmail",
      "renderSecurityAlertEmail",
      "renderTeamInviteEmail",
      "renderWelcomeEmail",
      "emailLayout",
      "escapeHtml",
    ] as const) {
      expect(typeof emails[name]).toBe("function")
    }
  })
})
