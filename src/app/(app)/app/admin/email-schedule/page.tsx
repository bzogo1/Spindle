import type { Metadata } from "next"

import { EmailScheduleScreen } from "@/components/admin/email-schedule-screen"

export const metadata: Metadata = { title: "Admin — Email schedule" }

export default function AdminEmailSchedulePage() {
  return (
    <div className="app-page">
      <div className="app-page-head">
        <div>
          <h1 className="app-page-title">Email schedule</h1>
          <p className="app-page-subtitle">
            Queue outbound emails for later delivery. Restricted to admin users.
          </p>
        </div>
      </div>
      <EmailScheduleScreen />
    </div>
  )
}
