import type { Metadata } from "next"
import { Suspense } from "react"

import { AuthShell } from "@/components/auth/auth-shell"
import { VerifyEmailScreen } from "@/components/auth/verify-email-screen"

export const metadata: Metadata = {
  title: "Verify your email",
  description: "Verify the email address on your Spindle account.",
}

function VerifyEmailFallback() {
  return (
    <>
      <span className="auth-eyebrow">Account security</span>
      <h1 className="auth-title">Verifying your email</h1>
      <p className="auth-loading" role="status">
        <span className="auth-spinner" aria-hidden="true" />
        Checking your verification link…
      </p>
    </>
  )
}

export default function VerifyEmailPage() {
  return (
    <AuthShell
      footer={
        <>
          Wrong account? <a href="/">Back to Spindle</a>
        </>
      }
    >
      <Suspense fallback={<VerifyEmailFallback />}>
        <VerifyEmailScreen />
      </Suspense>
    </AuthShell>
  )
}
