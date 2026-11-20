import type { Metadata } from "next"

import { WorkspaceAuditScreen } from "@/components/workspaces/audit-screen"

export const metadata: Metadata = { title: "Workspace audit log" }

export default async function WorkspaceAuditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  return (
    <div className="app-page">
      <div className="app-page-head">
        <div>
          <h1 className="app-page-title">Audit log</h1>
          <p className="app-page-subtitle">
            Workspace events such as member and settings changes, newest first. Restricted to owners
            and admins.
          </p>
        </div>
      </div>
      <WorkspaceAuditScreen workspaceId={id} />
    </div>
  )
}
