import type { Metadata } from "next"
import { Suspense } from "react"

import { AuthShell } from "@/components/auth/auth-shell"
import { TwoFactorRecoveryScreen } from "@/components/auth/two-factor-recovery-screen"

export const metadata: Metadata = {
  title: "Two-factor recovery",
  description: "Recover access to your Spindle account after losing your authenticator.",
}

function TwoFactorRecoveryFallback() {
  return (
    <>
      <span className="auth-eyebrow">Account security</span>
      <h1 className="auth-title">Loading recovery</h1>
      <p className="auth-loading" role="status">
        <span className="auth-spinner" aria-hidden="true" />
        Preparing two-factor recovery…
      </p>
    </>
  )
}

export default function TwoFactorRecoveryPage() {
  return (
    <AuthShell
      footer={
        <>
          Not you? <a href="/">Back to Spindle</a>
        </>
      }
    >
      <Suspense fallback={<TwoFactorRecoveryFallback />}>
        <TwoFactorRecoveryScreen />
      </Suspense>
    </AuthShell>
  )
}
