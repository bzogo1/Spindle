import type { Metadata } from "next"

import { TaxFormsScreen } from "@/components/admin/tax-forms-screen"

export const metadata: Metadata = { title: "Admin — Tax forms" }

export default function AdminTaxFormsPage() {
  return (
    <div className="app-page">
      <div className="app-page-head">
        <div>
          <h1 className="app-page-title">Tax forms</h1>
          <p className="app-page-subtitle">
            Review partner W-9 submissions and generate simulated 1099-NEC records. Export annual
            totals as CSV. No real IRS filing occurs. Restricted to admin users.
          </p>
        </div>
      </div>
      <TaxFormsScreen />
    </div>
  )
}
