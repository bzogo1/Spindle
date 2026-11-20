import type { Metadata } from "next"

import { ReferralRewardsSection } from "@/components/app/referral-rewards-section"

export const metadata: Metadata = { title: "Referral rewards" }

export default function ReferralRewardsPage() {
  return (
    <div className="app-page">
      <div className="app-page-head">
        <div>
          <h1 className="app-page-title">Referral rewards</h1>
          <p className="app-page-subtitle">
            Rewards earned from referrals you made. Entries are reporting records only — no credits
            or payouts are issued.
          </p>
        </div>
      </div>
      <ReferralRewardsSection />
    </div>
  )
}
