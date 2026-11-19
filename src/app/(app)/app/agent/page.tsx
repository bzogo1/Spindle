import type { Metadata } from "next"

import { AppPage } from "@/components/app/app-page"

export const metadata: Metadata = { title: "Agent" }

export default function AppAgentPage() {
  return (
    <AppPage
      title="Agent"
      lede="The project agent: reads files, edits in place, and runs multi-step tasks."
    >
      <div className="app-page-card">
        <h2>Agent placeholder</h2>
        <p>
          The in-app agent is distinct from the marketing <code>/agent</code> page — this route
          lives inside the authenticated shell.
        </p>
      </div>
    </AppPage>
  )
}
