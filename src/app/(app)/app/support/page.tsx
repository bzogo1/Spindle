import type { Metadata } from "next"

import { SupportTicketsScreen } from "@/components/app/support-tickets-screen"

export const metadata: Metadata = { title: "Support" }

export default function SupportPage() {
  return (
    <div className="app-page">
      <div className="app-page-head">
        <div>
          <h1 className="app-page-title">Support</h1>
          <p className="app-page-subtitle">
            Create a ticket, reply to our team, and track the status of your requests.
          </p>
        </div>
      </div>
      <SupportTicketsScreen />
    </div>
  )
}
