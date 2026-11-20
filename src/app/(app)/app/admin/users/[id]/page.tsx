import type { Metadata } from "next"

import { AdminUserDetail } from "@/components/admin/user-detail"

export const metadata: Metadata = { title: "Admin — User" }

export default async function AdminUserPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  return (
    <div className="app-page">
      <div className="app-page-head">
        <div>
          <h1 className="app-page-title">User</h1>
          <p className="app-page-subtitle">
            Account details and supported admin actions. Restricted to admin users.
          </p>
        </div>
      </div>
      <AdminUserDetail userId={id} />
    </div>
  )
}
