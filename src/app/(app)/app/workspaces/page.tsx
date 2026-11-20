import type { Metadata } from "next"

import { WorkspacesScreen } from "@/components/workspaces/workspaces-screen"

export const metadata: Metadata = { title: "Workspaces" }

export default function WorkspacesPage() {
  return (
    <div className="app-page">
      <div className="app-page-head">
        <div>
          <h1 className="app-page-title">Workspaces</h1>
          <p className="app-page-subtitle">
            Manage the workspaces you belong to and switch which one is active.
          </p>
        </div>
      </div>
      <WorkspacesScreen />
    </div>
  )
}
