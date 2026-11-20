import type { Metadata } from "next"

import { UsersScreen } from "@/components/admin/users-screen"

export const metadata: Metadata = { title: "Admin — Users" }

export default function AdminUsersPage() {
  return (
    <div className="app-page">
      <div className="app-page-head">
        <div>
          <h1 className="app-page-title">Users</h1>
          <p className="app-page-subtitle">
            Browse and inspect registered accounts. Restricted to admin users.
          </p>
        </div>
      </div>
      <UsersScreen />
    </div>
  )
}
