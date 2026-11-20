import type { Metadata } from "next"

import { FeatureFlagsScreen } from "@/components/admin/feature-flags-screen"

export const metadata: Metadata = { title: "Admin — Feature flags" }

export default function AdminFeatureFlagsPage() {
  return (
    <div className="app-page">
      <div className="app-page-head">
        <div>
          <h1 className="app-page-title">Feature flags</h1>
          <p className="app-page-subtitle">
            Manage runtime feature flags with per-user targeting and percentage rollouts. Restricted
            to admin users.
          </p>
        </div>
      </div>
      <FeatureFlagsScreen />
    </div>
  )
}
