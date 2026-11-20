import type { Metadata } from "next"

import { ReferralFraudScreen } from "@/components/admin/referral-fraud-screen"

export const metadata: Metadata = { title: "Admin — Referral fraud" }

export default function AdminReferralFraudPage() {
  return (
    <div className="app-page">
      <div className="app-page-head">
        <div>
          <h1 className="app-page-title">Referral fraud</h1>
          <p className="app-page-subtitle">
            Review queue for referrals flagged by the fraud rules — self-referrals, disposable
            emails, referral velocity, and duplicate device fingerprints. Restricted to admin users.
          </p>
        </div>
      </div>
      <ReferralFraudScreen />
    </div>
  )
}
