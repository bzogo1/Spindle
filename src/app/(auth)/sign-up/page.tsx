import type { Metadata } from "next"

import { AuthEntryScreen } from "@/components/auth/auth-entry-screen"
import { AuthSplitShell } from "@/components/auth/auth-split-shell"
import { PasswordStrengthMeter } from "@/components/auth/password-strength-meter"
import { listOAuthProviderNames } from "@/lib/auth/oauth-providers"
import { sanitizeNextPath } from "@/lib/auth/schemas"

export const metadata: Metadata = {
  title: "Sign up",
  description: "Create a Spindle workspace.",
  robots: { index: false, follow: false },
}

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>
}) {
  const params = await searchParams
  const rawNext = Array.isArray(params.next) ? params.next[0] : params.next
  const next = sanitizeNextPath(rawNext) ?? undefined

  return (
    <AuthSplitShell mode="sign-up">
      <AuthEntryScreen mode="sign-up" next={next} providers={listOAuthProviderNames()} />
      {/* Observes #auth-new-password and portals the meter into the field. */}
      <PasswordStrengthMeter inputId="auth-new-password" />
    </AuthSplitShell>
  )
}
