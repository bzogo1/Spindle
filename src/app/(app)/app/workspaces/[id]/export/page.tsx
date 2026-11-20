import type { Metadata } from "next"

import { WorkspaceExportScreen } from "@/components/workspaces/export-screen"

export const metadata: Metadata = { title: "Export workspace data" }

export default async function WorkspaceExportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  return (
    <div className="app-page">
      <div className="app-page-head">
        <div>
          <h1 className="app-page-title">Export workspace data</h1>
          <p className="app-page-subtitle">
            Download a JSON snapshot of this workspace&apos;s settings and member roster. Restricted
            to owners and admins because the export contains member personal information.
          </p>
        </div>
      </div>
      <WorkspaceExportScreen workspaceId={id} />
    </div>
  )
}
