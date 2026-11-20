import type { Metadata } from "next"

import { EmailAbScreen } from "@/components/admin/email-ab-screen"

export const metadata: Metadata = { title: "Admin — Email A/B" }

export default function AdminEmailAbPage() {
  return (
    <div className="app-page">
      <div className="app-page-head">
        <div>
          <h1 className="app-page-title">Email A/B</h1>
          <p className="app-page-subtitle">
            Manage email subject/body experiments and deterministic variant assignment. Restricted
            to admin users.
          </p>
        </div>
      </div>
      <EmailAbScreen />
    </div>
  )
}
