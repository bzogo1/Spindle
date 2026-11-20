import type { Metadata } from "next"

import { SegmentsScreen } from "@/components/admin/segments-screen"

export const metadata: Metadata = { title: "Admin — Segments" }

export default function AdminSegmentsPage() {
  return (
    <div className="app-page">
      <div className="app-page-head">
        <div>
          <h1 className="app-page-title">Segments</h1>
          <p className="app-page-subtitle">
            Rule-based user segments evaluated against the auth backend. Restricted to admin users.
            Segment definitions are stored in memory (dev seam).
          </p>
        </div>
      </div>
      <SegmentsScreen />
    </div>
  )
}
