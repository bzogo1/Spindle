import type { Metadata } from "next"

import { CommissionsScreen } from "@/components/admin/commissions-screen"

export const metadata: Metadata = { title: "Admin — Commissions" }

export default function AdminCommissionsPage() {
  return (
    <div className="app-page">
      <div className="app-page-head">
        <div>
          <h1 className="app-page-title">Commissions</h1>
          <p className="app-page-subtitle">
            Review and manage affiliate commission records. Marking a commission paid is a ledger
            status only — no money moves. Restricted to admin users.
          </p>
        </div>
      </div>
      <CommissionsScreen />
    </div>
  )
}
