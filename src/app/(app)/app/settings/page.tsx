import type { Metadata } from "next"

import { AppPage } from "@/components/app/app-page"

export const metadata: Metadata = { title: "Settings" }

export default function SettingsPage() {
  return (
    <AppPage title="Settings" lede="Workspace preferences, members, and account options.">
      <div className="app-page-card">
        <h2>Settings placeholder</h2>
        <p>Preferences are not editable in the mock shell yet.</p>
      </div>
    </AppPage>
  )
}
