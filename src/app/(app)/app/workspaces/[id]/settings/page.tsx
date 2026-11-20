import type { Metadata } from "next"

import { WorkspaceSettingsScreen } from "@/components/workspaces/settings-screen"

export const metadata: Metadata = { title: "Workspace settings" }

export default async function WorkspaceSettingsPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  return (
    <div className="app-page">
      <div className="app-page-head">
        <div>
          <h1 className="app-page-title">Workspace settings</h1>
          <p className="app-page-subtitle">
            Rename the workspace and configure member-facing preferences. Owners and admins can
            edit; members see a read-only view.
          </p>
        </div>
      </div>
      <WorkspaceSettingsScreen workspaceId={id} />
    </div>
  )
}
