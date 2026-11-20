import type { Metadata } from "next"

import { ReferralScreen } from "@/components/app/referral-screen"

export const metadata: Metadata = { title: "Referrals" }

export default function ReferralPage() {
  return (
    <div className="app-page">
      <div className="app-page-head">
        <div>
          <h1 className="app-page-title">Referrals</h1>
          <p className="app-page-subtitle">
            Share your referral link and track clicks, qualified signups, and rewards.
          </p>
        </div>
      </div>
      <ReferralScreen />
    </div>
  )
}
