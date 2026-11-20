import type { Metadata } from "next"

import { SearchInsightsDashboard } from "@/components/search-insights/search-insights-dashboard"

export const metadata: Metadata = { title: "Search insights" }

/**
 * Search analytics dashboard. Reads the localStorage event buffer written by
 * `src/lib/search-insights` — no server data, so this page is intentionally
 * a thin shell around the client component.
 *
 * Wiring required outside this file's ownership:
 *  - Optionally add a "Search insights" entry to
 *    `src/components/app/nav-items.tsx` pointing at `/app/search-insights`.
 *  - Instrument the command menu (`src/components/app/command-menu.tsx`) with
 *    `useTrackedSearch` / the tracker functions for events to appear here.
 */
export default function SearchInsightsPage() {
  return (
    <div className="app-page">
      <div className="grid max-w-2xl gap-3">
        <h1 className="text-2xl font-semibold">Search insights</h1>
        <p className="text-muted-foreground text-sm">
          Analytics for command-menu search: what people look for, where searches dead-end, and how
          fast the index answers.
        </p>
      </div>
      <SearchInsightsDashboard />
    </div>
  )
}
