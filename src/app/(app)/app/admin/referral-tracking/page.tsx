import type { Metadata } from "next"

import { ReferralTrackingScreen } from "@/components/admin/referral-tracking-screen"

export const metadata: Metadata = { title: "Admin — Referral tracking" }

export default function AdminReferralTrackingPage() {
  return (
    <div className="app-page">
      <div className="app-page-head">
        <div>
          <h1 className="app-page-title">Referral tracking</h1>
          <p className="app-page-subtitle">
            Funnel-style referral tracking — status counts and conversion rates, per-source and
            per-code breakdowns, top referrers, and a daily attribution series. Restricted to admin
            users.
          </p>
        </div>
      </div>
      <ReferralTrackingScreen />
    </div>
  )
}
