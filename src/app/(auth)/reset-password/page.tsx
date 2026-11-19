import type { Metadata } from "next"

import { AuthShell } from "@/components/auth/auth-shell"
import { ResetRequestPanel } from "@/components/auth/reset-request-panel"

export const metadata: Metadata = {
  title: "Reset your password",
  description: "Request a password reset link for your Spindle account.",
}

export default function ResetPasswordPage() {
  return (
    <AuthShell
      footer={
        <>
          Remembered your password? <a href="/">Back to Spindle</a>
        </>
      }
    >
      <ResetRequestPanel />
    </AuthShell>
  )
}
