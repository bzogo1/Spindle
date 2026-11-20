import type { Metadata } from "next"

import { DirectorySyncScreen } from "@/components/workspaces/directory-sync-screen"

export const metadata: Metadata = { title: "Directory sync" }

export default async function WorkspaceDirectoryPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  return (
    <div className="app-page">
      <div className="app-page-head">
        <div>
          <h1 className="app-page-title">Directory sync</h1>
          <p className="app-page-subtitle">
            Reconcile workspace membership against a directory export. Owners and admins can preview
            and apply changes; members see a read-only view.
          </p>
        </div>
      </div>
      <DirectorySyncScreen workspaceId={id} />
    </div>
  )
}
