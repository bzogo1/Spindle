import type { Metadata } from "next"

import { PartnerPortalScreen } from "@/components/partner/partner-portal-screen"

export const metadata: Metadata = { title: "Partner portal" }

export default function PartnerPortalPage() {
  return (
    <div className="app-page">
      <div className="app-page-head">
        <div>
          <h1 className="app-page-title">Partner portal</h1>
          <p className="app-page-subtitle">
            Your partner dashboard — performance stats, payout and tax profile, announcements, and
            resources.
          </p>
        </div>
      </div>
      <PartnerPortalScreen />
    </div>
  )
}
