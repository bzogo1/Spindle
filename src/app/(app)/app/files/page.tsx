import type { Metadata } from "next"

import { AppPage } from "@/components/app/app-page"

export const metadata: Metadata = { title: "Files" }

export default function FilesPage() {
  return (
    <AppPage
      title="Files"
      lede="The workspace file library — uploads, folders, and previews across projects."
    >
      <div className="app-page-card">
        <h2>No files yet</h2>
        <p>Uploads and the file browser are not wired up in the mock shell.</p>
      </div>
    </AppPage>
  )
}
