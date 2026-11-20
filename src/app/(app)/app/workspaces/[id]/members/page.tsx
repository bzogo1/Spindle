import type { Metadata } from "next"

import { WorkspaceMembersScreen } from "@/components/workspaces/members-screen"

export const metadata: Metadata = { title: "Workspace members" }

export default async function WorkspaceMembersPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  return (
    <div className="app-page">
      <div className="app-page-head">
        <div>
          <h1 className="app-page-title">Workspace members</h1>
          <p className="app-page-subtitle">
            See who belongs to this workspace and manage roles. Owners and admins can change roles
            and remove members; members see a read-only roster.
          </p>
        </div>
      </div>
      <WorkspaceMembersScreen workspaceId={id} />
    </div>
  )
}
