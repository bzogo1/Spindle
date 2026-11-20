import type { Metadata } from "next"

import { AffiliatesScreen } from "@/components/admin/affiliates-screen"

export const metadata: Metadata = { title: "Admin — Affiliates" }

export default function AdminAffiliatesPage() {
  return (
    <div className="app-page">
      <div className="app-page-head">
        <div>
          <h1 className="app-page-title">Affiliates</h1>
          <p className="app-page-subtitle">
            Review affiliate applications, approve tracking codes, and monitor clicks and
            conversions. Restricted to admin users.
          </p>
        </div>
      </div>
      <AffiliatesScreen />
    </div>
  )
}
