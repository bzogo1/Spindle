import type { Metadata } from "next"

import { NewsletterScreen } from "@/components/admin/newsletter-screen"

export const metadata: Metadata = { title: "Admin — Newsletter" }

export default function AdminNewsletterPage() {
  return (
    <div className="app-page">
      <div className="app-page-head">
        <div>
          <h1 className="app-page-title">Newsletter</h1>
          <p className="app-page-subtitle">
            Manage subscribers and draft campaigns. Restricted to admin users.
          </p>
        </div>
      </div>
      <NewsletterScreen />
    </div>
  )
}
