import type { Metadata } from "next"

import { DangerZoneScreen } from "@/components/workspaces/danger-zone-screen"

export const metadata: Metadata = { title: "Danger zone" }

export default async function WorkspaceDangerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  return (
    <div className="app-page">
      <div className="app-page-head">
        <div>
          <h1 className="app-page-title">Danger zone</h1>
          <p className="app-page-subtitle">
            Irreversible workspace actions. Only the workspace owner can delete a workspace.
          </p>
        </div>
      </div>
      <DangerZoneScreen workspaceId={id} />
    </div>
  )
}
