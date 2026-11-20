import type { Metadata } from "next"

import { BrandingScreen } from "@/components/workspaces/branding-screen"

export const metadata: Metadata = { title: "Workspace branding" }

export default async function WorkspaceBrandingPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  return (
    <div className="app-page">
      <div className="app-page-head">
        <div>
          <h1 className="app-page-title">Workspace branding</h1>
          <p className="app-page-subtitle">
            Customize how this workspace appears on its sign-in page — display name, logo, and
            accent colors. Owners and admins only. Reach the branded sign-in at{" "}
            <code>/sign-in?workspace=&lt;slug-or-id&gt;</code>.
          </p>
        </div>
      </div>
      <BrandingScreen workspaceId={id} />
    </div>
  )
}
