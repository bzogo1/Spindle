import type { Metadata } from "next"

import { SessionsScreen } from "@/components/app/sessions-screen"

export const metadata: Metadata = { title: "Sessions" }

export default function SessionsPage() {
  return (
    <div className="app-page">
      <div className="app-page-head">
        <div>
          <h1 className="app-page-title">Sessions</h1>
          <p className="app-page-subtitle">
            Review the devices where your account is signed in and revoke sessions you don&apos;t
            recognize.
          </p>
        </div>
      </div>
      <SessionsScreen />
    </div>
  )
}
