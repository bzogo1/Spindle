import type { Metadata } from "next"
import { Suspense } from "react"

import { AuthShell } from "@/components/auth/auth-shell"
import { AcceptInviteScreen } from "./accept-invite-screen"

export const metadata: Metadata = {
  title: "Accept your invitation",
  description: "Accept a Spindle workspace invitation.",
}

function AcceptInviteFallback() {
  return (
    <>
      <span className="auth-eyebrow">Workspace invitation</span>
      <h1 className="auth-title">Checking your invitation</h1>
      <p className="auth-loading" role="status">
        <span className="auth-spinner" aria-hidden="true" />
        Hold on while we check this link…
      </p>
    </>
  )
}

export default function AcceptInvitePage() {
  return (
    <AuthShell
      footer={
        <>
          Not expecting an invite? <a href="/">Back to Spindle</a>
        </>
      }
    >
      <Suspense fallback={<AcceptInviteFallback />}>
        <AcceptInviteScreen />
      </Suspense>
    </AuthShell>
  )
}
