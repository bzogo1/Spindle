import type { Metadata } from "next"

import { LoginHistoryScreen } from "@/components/app/login-history-screen"

export const metadata: Metadata = { title: "Login history" }

export default function LoginHistoryPage() {
  return (
    <div className="app-page">
      <div className="app-page-head">
        <div>
          <h1 className="app-page-title">Login history</h1>
          <p className="app-page-subtitle">
            Review the sign-in and account security events recorded for your account — successful
            and failed sign-ins, two-factor changes, and session activity.
          </p>
        </div>
      </div>
      <LoginHistoryScreen />
    </div>
  )
}
