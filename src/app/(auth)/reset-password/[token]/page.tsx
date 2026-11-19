import type { Metadata } from "next"

import { AuthShell } from "@/components/auth/auth-shell"
import { ResetPasswordForm } from "@/components/auth/reset-password-form"

export const metadata: Metadata = {
  title: "Choose a new password",
  description: "Choose a new password for your Spindle account.",
}

export default async function ResetPasswordTokenPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params

  return (
    <AuthShell
      footer={
        <>
          Need help? <a href="/about#contact">Contact support</a>
        </>
      }
    >
      <ResetPasswordForm token={token} />
    </AuthShell>
  )
}
