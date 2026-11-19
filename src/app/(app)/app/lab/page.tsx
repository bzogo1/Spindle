import type { Metadata } from "next"

import { AppPage } from "@/components/app/app-page"

export const metadata: Metadata = { title: "Lab" }

export default function AppLabPage() {
  return (
    <AppPage title="Lab" lede="Notebooks, scripts, and live computations for the selected project.">
      <div className="app-page-card">
        <h2>Lab placeholder</h2>
        <p>
          The in-app lab is distinct from the marketing <code>/lab</code> page — this route lives
          inside the authenticated shell.
        </p>
      </div>
    </AppPage>
  )
}
