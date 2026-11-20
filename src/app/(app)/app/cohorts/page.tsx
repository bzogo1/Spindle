import type { Metadata } from "next"

import { AppPage } from "@/components/app/app-page"
import { CohortsScreen } from "@/components/app/cohorts-screen"

export const metadata: Metadata = { title: "Cohorts" }

/**
 * User cohort analysis: signup-week cohorts × weekly activity retention.
 * Backed by GET /api/cohorts, which currently serves labelled demo data —
 * see src/lib/cohorts.ts.
 *
 * NOTE: nothing links here yet — nav-items.tsx and the app layouts are owned
 * by other changes, so adding a nav entry point is an accepted deferral left
 * to the integrating work (same pattern as the NPS page).
 */
export default function CohortsPage() {
  return (
    <AppPage
      title="Cohorts"
      lede="Weekly retention by signup week — see how each group of new users sticks around over time."
    >
      <CohortsScreen />
    </AppPage>
  )
}
