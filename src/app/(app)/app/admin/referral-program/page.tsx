import type { Metadata } from "next"

import { ReferralProgramScreen } from "@/components/admin/referral-program-screen"

export const metadata: Metadata = { title: "Admin — Referral program" }

export default function AdminReferralProgramPage() {
  return (
    <div className="app-page">
      <div className="app-page-head">
        <div>
          <h1 className="app-page-title">Referral program</h1>
          <p className="app-page-subtitle">
            Program settings, attribution stats, and the recent referral activity feed. Reward
            amounts are reporting labels only — there are no real payouts. Restricted to admin
            users.
          </p>
        </div>
      </div>
      <ReferralProgramScreen />
    </div>
  )
}
