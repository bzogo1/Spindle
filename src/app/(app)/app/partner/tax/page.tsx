import type { Metadata } from "next"

import { PartnerTaxFormsSection } from "@/components/partner/tax-forms-section"

export const metadata: Metadata = { title: "Partner — Tax forms" }

export default function PartnerTaxPage() {
  return (
    <div className="app-page">
      <div className="app-page-head">
        <div>
          <h1 className="app-page-title">Tax forms</h1>
          <p className="app-page-subtitle">
            Manage your W-9 details and review tax form records. Your TIN is never collected here —
            complete the official IRS form separately.
          </p>
        </div>
      </div>
      <PartnerTaxFormsSection />
    </div>
  )
}
