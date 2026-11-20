export { emailLayout, escapeHtml, EMAIL_FOOTER_LINKS, EMAIL_ORIGIN } from "./layout"
export type { EmailFooterLink, EmailLayoutInput } from "./layout"
export {
  renderAuthLinkEmail,
  renderContactAutoReplyEmail,
  renderFeedbackReceivedEmail,
  renderInvitationReminderEmail,
  renderNewsletterConfirmEmail,
  renderNotificationDigestEmail,
  renderReferralAnnouncementEmail,
  renderReferralInviteEmail,
  renderReferralRewardEmail,
  renderResetPasswordEmail,
  renderSecurityAlertEmail,
  renderTeamInviteEmail,
  renderWelcomeEmail,
  renderWelcomeSeriesEmail,
  WELCOME_SERIES_STEPS,
} from "./templates"
export type {
  AuthLinkPurpose,
  NotificationDigestItem,
  RenderedEmail,
  WelcomeSeriesStep,
} from "./templates"
