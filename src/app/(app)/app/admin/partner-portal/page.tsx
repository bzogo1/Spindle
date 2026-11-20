import type { Metadata } from "next"

import { AdminPartnerPortalScreen } from "@/components/admin/partner-portal-screen"

export const metadata: Metadata = { title: "Admin — Partner portal" }

export default function AdminPartnerPortalPage() {
  return (
    <div className="app-page">
      <div className="app-page-head">
        <div>
          <h1 className="app-page-title">Partner portal</h1>
          <p className="app-page-subtitle">
            Partner account overview, portal announcements, and resource links. Restricted to admin
            users.
          </p>
        </div>
      </div>
      <AdminPartnerPortalScreen />
    </div>
  )
}
