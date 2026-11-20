import type { Metadata } from "next"

import { AnnouncementsScreen } from "@/components/admin/announcements-screen"

export const metadata: Metadata = { title: "Admin — Announcements" }

export default function AdminAnnouncementsPage() {
  return (
    <div className="app-page">
      <div className="app-page-head">
        <div>
          <h1 className="app-page-title">Announcements</h1>
          <p className="app-page-subtitle">
            Publish feature announcements shown as dismissible banners to app users. Restricted to
            admin users.
          </p>
        </div>
      </div>
      <AnnouncementsScreen />
    </div>
  )
}
