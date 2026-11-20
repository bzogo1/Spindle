import type { Metadata } from "next"

import { PayoutsScreen } from "@/components/admin/payouts-screen"

export const metadata: Metadata = { title: "Admin — Payouts" }

export default function AdminPayoutsPage() {
  return (
    <div className="app-page">
      <div className="app-page-head">
        <div>
          <h1 className="app-page-title">Payouts</h1>
          <p className="app-page-subtitle">
            Run simulated affiliate payout batches over commission periods. Processing marks items
            paid or failed by fixed rules — no real money moves. Restricted to admin users.
          </p>
        </div>
      </div>
      <PayoutsScreen />
    </div>
  )
}
