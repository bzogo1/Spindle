import type { Metadata } from "next"
import { Suspense } from "react"

import { AuthShell } from "@/components/auth/auth-shell"
import { AccountRecoveryScreen } from "@/components/auth/account-recovery-screen"

export const metadata: Metadata = {
  title: "Account recovery",
  description: "Recover access to your Spindle account with a verified email link.",
}

function AccountRecoveryFallback() {
  return (
    <>
      <span className="auth-eyebrow">Account recovery</span>
      <h1 className="auth-title">Loading recovery</h1>
      <p className="auth-loading" role="status">
        <span className="auth-spinner" aria-hidden="true" />
        Preparing your recovery options…
      </p>
    </>
  )
}

export default function AccountRecoveryPage() {
  return (
    <AuthShell
      footer={
        <>
          Remembered your password? <a href="/">Back to Spindle</a>
        </>
      }
    >
      <Suspense fallback={<AccountRecoveryFallback />}>
        <AccountRecoveryScreen />
      </Suspense>
    </AuthShell>
  )
}
