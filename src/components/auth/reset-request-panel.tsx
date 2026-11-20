"use client"

import { useLanguage } from "@/components/i18n/language-provider"
import { requestPasswordReset } from "@/lib/auth/auth-client"

import { EmailLinkForm } from "./email-link-form"

/** sessionStorage scope keeping the password-reset cooldown separate from other auth flows. */
const RESET_PASSWORD_COOLDOWN_KEY = "spindle:auth:resend-cooldown:reset-password"

/** Standalone `/reset-password` request card content. */
export function ResetRequestPanel() {
  const { t } = useLanguage()
  return (
    <>
      <span className="auth-eyebrow">{t("auth.recoveryEyebrow")}</span>
      <h1 className="auth-title">{t("auth.resetRequest.title")}</h1>
      <p className="auth-desc">{t("auth.resetRequest.description")}</p>

      <EmailLinkForm
        idPrefix="reset"
        cooldownKey={RESET_PASSWORD_COOLDOWN_KEY}
        submitLabel={t("auth.sendResetLink")}
        sentTitle={t("auth.checkInbox")}
        sentMessage={(email) => t("auth.resetRequest.sentMessage", { email })}
        onRequest={(email) => requestPasswordReset(email)}
        backHref="/"
        backLabel={t("auth.backToSpindle")}
      />
    </>
  )
}
