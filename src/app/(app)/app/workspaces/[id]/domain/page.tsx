import type { Metadata } from "next"

import { WorkspaceDomainScreen } from "@/components/workspaces/domain-screen"

export const metadata: Metadata = { title: "Custom domain" }

export default async function WorkspaceDomainPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  return (
    <div className="app-page">
      <div className="app-page-head">
        <div>
          <h1 className="app-page-title">Custom domain</h1>
          <p className="app-page-subtitle">
            Attach a hostname to this workspace and prove ownership with a DNS TXT record. Owners
            and admins can edit; members see a read-only view.
          </p>
        </div>
      </div>
      <WorkspaceDomainScreen workspaceId={id} />
    </div>
  )
}
