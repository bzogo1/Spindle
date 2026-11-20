import type { Metadata } from "next"

import { CreateWorkspaceScreen } from "@/components/workspaces/create-workspace-screen"

export const metadata: Metadata = { title: "New workspace" }

export default function NewWorkspacePage() {
  return (
    <div className="app-page">
      <div className="app-page-head">
        <div>
          <h1 className="app-page-title">New workspace</h1>
          <p className="app-page-subtitle">
            Create a workspace to group your projects, members, and settings. You&apos;ll be the
            owner and it becomes your active workspace.
          </p>
        </div>
      </div>
      <CreateWorkspaceScreen />
    </div>
  )
}
