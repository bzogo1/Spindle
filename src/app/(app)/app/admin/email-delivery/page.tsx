import type { Metadata } from "next"

import { EmailDeliveryScreen } from "@/components/admin/email-delivery-screen"

export const metadata: Metadata = { title: "Admin — Email delivery" }

export default function AdminEmailDeliveryPage() {
  return (
    <div className="app-page">
      <div className="app-page-head">
        <div>
          <h1 className="app-page-title">Email delivery</h1>
          <p className="app-page-subtitle">
            Track outbound email lifecycle events — queued, sent, delivered, opened, clicked,
            bounced. Restricted to admin users.
          </p>
        </div>
      </div>
      <EmailDeliveryScreen />
    </div>
  )
}
