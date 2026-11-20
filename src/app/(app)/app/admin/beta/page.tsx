import type { Metadata } from "next"

import { BetaAdminScreen } from "@/components/admin/beta-screen"

export const metadata: Metadata = { title: "Admin — Beta programs" }

export default function AdminBetaPage() {
  return (
    <div className="app-page">
      <div className="app-page-head">
        <div>
          <h1 className="app-page-title">Beta programs</h1>
          <p className="app-page-subtitle">
            Create beta programs, open or close self-service enrollment, and manage which users are
            enrolled. Restricted to admin users.
          </p>
        </div>
      </div>
      <BetaAdminScreen />
    </div>
  )
}
