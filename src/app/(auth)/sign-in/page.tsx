import type { Metadata } from "next"

import { AuthEntryScreen } from "@/components/auth/auth-entry-screen"
import { AuthSplitShell } from "@/components/auth/auth-split-shell"
import { listOAuthProviderNames } from "@/lib/auth/oauth-providers"
import { sanitizeNextPath } from "@/lib/auth/schemas"
import { getPublicBrandingByKey } from "@/lib/workspace-branding"

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to your Spindle workspace.",
  robots: { index: false, follow: false },
}

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{
    next?: string | string[]
    workspace?: string | string[]
    brand?: string | string[]
  }>
}) {
  const params = await searchParams
  const rawNext = firstParam(params.next)
  const next = sanitizeNextPath(rawNext) ?? undefined

  // Workspace-branded sign-in: `/sign-in?workspace=<slug-or-id>` (or the
  // `?brand=` alias) resolves the public branding subset straight from the
  // store — the same data `GET /api/workspaces/brand` serves. Unknown or
  // unconfigured workspaces simply get the default look.
  const brandKey = firstParam(params.workspace) ?? firstParam(params.brand)
  const branding = brandKey ? getPublicBrandingByKey(brandKey) : null

  return (
    <AuthSplitShell mode="sign-in" branding={branding}>
      <AuthEntryScreen mode="sign-in" next={next} providers={listOAuthProviderNames()} />
    </AuthSplitShell>
  )
}
