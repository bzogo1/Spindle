import type { Metadata } from "next"

import { ReleaseNotesScreen } from "@/components/admin/release-notes-screen"

export const metadata: Metadata = { title: "Admin — Release notes email" }

export default function AdminReleaseNotesPage() {
  return (
    <div className="app-page">
      <div className="app-page-head">
        <div>
          <h1 className="app-page-title">Release notes email</h1>
          <p className="app-page-subtitle">
            Preview and send the latest changelog entries as an email to newsletter subscribers.
            Restricted to admin users.
          </p>
        </div>
      </div>
      <ReleaseNotesScreen />
    </div>
  )
}
