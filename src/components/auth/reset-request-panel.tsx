"use client"

import { EmailLinkForm } from "./email-link-form"

/** Standalone `/reset-password` request card content. */
export function ResetRequestPanel() {
  return (
    <>
      <span className="auth-eyebrow">Account recovery</span>
      <h1 className="auth-title">Reset your password</h1>
      <p className="auth-desc">
        Enter the work email on your Spindle account. If it matches, we&apos;ll send a link to
        choose a new password.
      </p>

      <EmailLinkForm
        idPrefix="reset"
        submitLabel="Send reset link"
        sentTitle="Check your inbox"
        sentMessage={(email) => (
          <>
            We sent a reset link to <strong>{email}</strong>. The link expires in 30 minutes.
          </>
        )}
        backHref="/"
        backLabel="Back to Spindle"
      />
    </>
  )
}
