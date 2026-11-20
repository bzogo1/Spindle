import type { Metadata } from "next"
import { Suspense } from "react"

import { AuthShell } from "@/components/auth/auth-shell"
import { MagicLinkScreen } from "@/components/auth/magic-link-screen"
import { getMagicLinkConfig } from "@/lib/auth/magic-link-config"

export const metadata: Metadata = {
  title: "Signing you in",
  description: "Passwordless sign-in for Spindle.",
  robots: { index: false, follow: false },
}

function Fallback() {
  return (
    <>
      <span className="auth-eyebrow">Account security</span>
      <h1 className="auth-title">Signing you in</h1>
      <p className="auth-loading" role="status">
        <span className="auth-spinner" aria-hidden="true" />
        Checking your sign-in link…
      </p>
    </>
  )
}

export default function MagicLinkPage() {
  // Server-side read of the configured link lifetime so the screen can show
  // "expires in N minutes" without exposing env vars to the client bundle.
  const magicLink = getMagicLinkConfig()
  return (
    <AuthShell
      footer={
        <>
          Need help? <a href="/about#contact">Contact support</a>
        </>
      }
    >
      <Suspense fallback={<Fallback />}>
        <MagicLinkScreen expiresInMinutes={magicLink.expiresInMinutes} />
      </Suspense>
    </AuthShell>
  )
}
