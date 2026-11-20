import type { Metadata } from "next"

import { LandingAbScreen } from "@/components/admin/landing-ab-screen"

export const metadata: Metadata = { title: "Admin — Landing A/B" }

export default function AdminLandingAbPage() {
  return (
    <div className="app-page">
      <div className="app-page-head">
        <div>
          <h1 className="app-page-title">Landing A/B</h1>
          <p className="app-page-subtitle">
            Manage landing-page experiments (currently <code>referral-landing</code> for{" "}
            <code>/r/[code]</code>), variant weights and copy overrides, and per-variant view/click
            results. Restricted to admin users.
          </p>
        </div>
      </div>
      <LandingAbScreen />
    </div>
  )
}
