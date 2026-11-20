import type { Metadata } from "next"

import { AffiliateScreen } from "@/components/app/affiliate-screen"

export const metadata: Metadata = { title: "Affiliate program" }

export default function AffiliatePage() {
  return (
    <div className="app-page">
      <div className="app-page-head">
        <div>
          <h1 className="app-page-title">Affiliate program</h1>
          <p className="app-page-subtitle">
            Apply for an affiliate account, share your tracking link, and track clicks and
            conversions.
          </p>
        </div>
      </div>
      <AffiliateScreen />
    </div>
  )
}
