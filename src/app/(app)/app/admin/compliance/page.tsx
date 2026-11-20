import type { Metadata } from "next"

import { ComplianceScreen } from "@/components/admin/compliance-screen"

export const metadata: Metadata = { title: "Admin — Compliance" }

export default function AdminCompliancePage() {
  return (
    <div className="app-page">
      <div className="app-page-head">
        <div>
          <h1 className="app-page-title">Compliance</h1>
          <p className="app-page-subtitle">
            Compliance cases for the affiliate program — fraud reviews, policy violations, payout
            holds, and KYC — plus program-level reporting and the case audit-trail export.
            Restricted to admin users.
          </p>
        </div>
      </div>
      <ComplianceScreen />
    </div>
  )
}
