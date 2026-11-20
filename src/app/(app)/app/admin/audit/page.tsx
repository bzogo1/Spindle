import type { Metadata } from "next"

import { AuditScreen } from "@/components/admin/audit-screen"

export const metadata: Metadata = { title: "Admin — Audit log" }

export default function AdminAuditPage() {
  return (
    <div className="app-page">
      <div className="app-page-head">
        <div>
          <h1 className="app-page-title">Audit log</h1>
          <p className="app-page-subtitle">
            Authentication and security events recorded across the platform. Restricted to admin
            users.
          </p>
        </div>
      </div>
      <AuditScreen />
    </div>
  )
}
