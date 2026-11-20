import type { Metadata } from "next"

import { ChurnScreen } from "@/components/admin/churn-screen"

export const metadata: Metadata = { title: "Admin — Churn risk" }

export default function AdminChurnPage() {
  return (
    <div className="app-page">
      <div className="app-page-head">
        <div>
          <h1 className="app-page-title">Churn risk</h1>
          <p className="app-page-subtitle">
            Heuristic risk scoring across accounts, ranked by signal strength. Restricted to admin
            users.
          </p>
        </div>
      </div>
      <ChurnScreen />
    </div>
  )
}
