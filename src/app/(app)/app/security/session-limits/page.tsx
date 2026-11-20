import type { Metadata } from "next"

import { SessionLimitsPanel } from "@/components/app/session-limits-panel"

export const metadata: Metadata = { title: "Session limits" }

export default function SessionLimitsPage() {
  return (
    <div className="app-page">
      <div className="app-page-head">
        <div>
          <h1 className="app-page-title">Session limits</h1>
          <p className="app-page-subtitle">
            Control how many devices can stay signed in to your account at once. When a new sign-in
            would exceed the limit, the oldest session is signed out automatically.
          </p>
        </div>
      </div>
      <SessionLimitsPanel />
    </div>
  )
}
