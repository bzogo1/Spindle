import type { Metadata } from "next"

import { WinBackScreen } from "@/components/admin/win-back-screen"

export const metadata: Metadata = { title: "Admin — Win-back campaigns" }

export default function AdminWinBackPage() {
  return (
    <div className="app-page">
      <div className="app-page-head">
        <div>
          <h1 className="app-page-title">Win-back campaigns</h1>
          <p className="app-page-subtitle">
            Re-engagement emails for inactive users. Campaigns are drafts until an admin runs them;
            opted-out addresses are always suppressed. Restricted to admin users.
          </p>
        </div>
      </div>
      <WinBackScreen />
    </div>
  )
}
