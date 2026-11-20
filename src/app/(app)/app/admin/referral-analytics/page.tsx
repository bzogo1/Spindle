import type { Metadata } from "next"

import { ReferralAnalyticsScreen } from "@/components/admin/referral-analytics-screen"

export const metadata: Metadata = { title: "Admin — Referral analytics" }

export default function AdminReferralAnalyticsPage() {
  return (
    <div className="app-page">
      <div className="app-page-head">
        <div>
          <h1 className="app-page-title">Referral analytics</h1>
          <p className="app-page-subtitle">
            Program-level referral performance — health score, signup cohorts, referrer leaderboard,
            reward economics, and fraud exposure. Restricted to admin users.
          </p>
        </div>
      </div>
      <ReferralAnalyticsScreen />
    </div>
  )
}
