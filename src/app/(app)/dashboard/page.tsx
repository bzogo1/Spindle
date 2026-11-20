import type { Metadata } from "next"

import { AnalyticsCard } from "@/components/app/analytics-card"
import { DashboardScreen } from "@/components/app/dashboard-screen"
import { TimezoneIndicator } from "@/components/app/timezone-indicator"

export const metadata: Metadata = { title: "Dashboard" }

export default function DashboardPage() {
  return (
    <div className="app-page">
      <TimezoneIndicator />
      <DashboardScreen />
      <AnalyticsCard />
    </div>
  )
}
