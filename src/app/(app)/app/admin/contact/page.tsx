import type { Metadata } from "next"

import { ContactAnalyticsPanel } from "@/components/admin/contact-analytics-panel"
import { ContactInbox } from "@/components/admin/contact-inbox"

export const metadata: Metadata = { title: "Admin — Contact inbox" }

export default function AdminContactPage() {
  return (
    <div className="app-page">
      <div className="app-page-head">
        <div>
          <h1 className="app-page-title">Contact inbox</h1>
          <p className="app-page-subtitle">
            Messages from the public contact form, routed to support queues. Restricted to admin
            users.
          </p>
        </div>
      </div>
      <ContactAnalyticsPanel />
      <ContactInbox />
    </div>
  )
}
