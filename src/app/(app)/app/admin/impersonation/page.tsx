import type { Metadata } from "next"

import { ImpersonationPanel } from "@/components/admin/impersonation-panel"

export const metadata: Metadata = { title: "Admin — Impersonation" }

export default function AdminImpersonationPage() {
  return (
    <div className="app-page">
      <div className="app-page-head">
        <div>
          <h1 className="app-page-title">Impersonation</h1>
          <p className="app-page-subtitle">
            Start a time-boxed support session as another user to reproduce issues. Restricted to
            admin users.
          </p>
        </div>
      </div>
      <ImpersonationPanel />
    </div>
  )
}
