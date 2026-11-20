import type { Metadata } from "next"
import { Suspense } from "react"

import { AuthShell } from "@/components/auth/auth-shell"
import { OAuthCallbackScreen } from "@/components/auth/oauth-callback-screen"

export const metadata: Metadata = {
  title: "Finishing sign-in",
  description: "OAuth sign-in callback for Spindle.",
  robots: { index: false, follow: false },
}

function Fallback() {
  return (
    <>
      <span className="auth-eyebrow">Account security</span>
      <h1 className="auth-title">Finishing sign-in</h1>
      <p className="auth-loading" role="status">
        <span className="auth-spinner" aria-hidden="true" />
        Confirming with the provider…
      </p>
    </>
  )
}

export default function OAuthCallbackPage() {
  return (
    <AuthShell
      footer={
        <>
          Need help? <a href="/about#contact">Contact support</a>
        </>
      }
    >
      <Suspense fallback={<Fallback />}>
        <OAuthCallbackScreen />
      </Suspense>
    </AuthShell>
  )
}
