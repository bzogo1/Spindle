"use client"

import { useSearchParams } from "next/navigation"
import { AlertTriangle } from "lucide-react"

import { TwoFactorRecoveryConfirm } from "./two-factor-recovery-confirm"

/**
 * `/two-factor-recovery` screen: reads the `token` query param from the
 * emailed link and renders the confirm step. Recovery routes require an
 * authenticated session — if the link is opened signed-out the confirm POST
 * fails with `unauthenticated`, which the confirm view surfaces as an error;
 * the footer links back to sign-in.
 */
export function TwoFactorRecoveryScreen() {
  const searchParams = useSearchParams()
  const token = searchParams.get("token")

  if (!token) {
    return (
      <div className="app-field" role="alert">
        <span className="app-field-label">Two-factor recovery</span>
        <p className="app-field-hint">
          <AlertTriangle aria-hidden="true" /> This recovery link is missing its token. Request a
          new one from your account security settings.
        </p>
      </div>
    )
  }

  return (
    <div className="app-field">
      <span className="app-field-label">Two-factor recovery</span>
      <p className="app-field-hint">
        You must be signed in to confirm a recovery — sign-in sessions are usually still active on
        your other devices even without the authenticator.
      </p>
      <TwoFactorRecoveryConfirm token={token} />
    </div>
  )
}
