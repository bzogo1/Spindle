import type { Metadata } from "next"

import { DashboardWorkspaceSettingsScreen } from "@/components/dashboard/workspace-settings-screen"

export const metadata: Metadata = { title: "Workspace settings" }

export default function DashboardWorkspaceSettingsPage() {
  return (
    <div className="app-page">
      <div className="app-page-head">
        <div>
          <h1 className="app-page-title">Workspace settings</h1>
          <p className="app-page-subtitle">
            Manage the name, slug, and description for your current workspace. Changes are stored
            locally — the workspace settings API is not wired up yet.
          </p>
        </div>
      </div>
      <DashboardWorkspaceSettingsScreen />
    </div>
  )
}
