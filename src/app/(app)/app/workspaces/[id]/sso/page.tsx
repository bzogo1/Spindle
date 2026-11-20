import type { Metadata } from "next"

import { SsoScreen } from "@/components/workspaces/sso-screen"

export const metadata: Metadata = { title: "Workspace SSO" }

export default async function WorkspaceSsoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  return (
    <div className="app-page">
      <div className="app-page-head">
        <div>
          <h1 className="app-page-title">Single sign-on</h1>
          <p className="app-page-subtitle">
            Configure your workspace identity provider (SAML or OIDC). Owners and admins only — SSO
            settings are hidden from members. Note: protocol enforcement is not implemented yet;
            this stores configuration only.
          </p>
        </div>
      </div>
      <SsoScreen workspaceId={id} />
    </div>
  )
}
