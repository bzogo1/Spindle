import type { Metadata } from "next"

import { ReferralRewardsScreen } from "@/components/admin/referral-rewards-screen"

export const metadata: Metadata = { title: "Admin — Referral rewards" }

export default function AdminReferralRewardsPage() {
  return (
    <div className="app-page">
      <div className="app-page-head">
        <div>
          <h1 className="app-page-title">Referral rewards</h1>
          <p className="app-page-subtitle">
            The reward ledger: issue reporting rewards for qualified referral attributions and
            revoke them when needed. Rewards are ledger records only — there are no real payouts.
            Restricted to admin users.
          </p>
        </div>
      </div>
      <ReferralRewardsScreen />
    </div>
  )
}
