"use client"

import { useEffect, useState } from "react"

import { getAppStats, initAppAnalytics, type AppEventStats } from "@/lib/apps/analytics"

export interface AppAnalyticsStatsProps {
  appId: string
  /** When true, shows a button that records a sample event for demos. */
  demo?: boolean
}

function formatTime(timestamp: number | null): string {
  if (timestamp === null) return "—"
  return new Date(timestamp).toLocaleString()
}

function statsToRows(stats: AppEventStats): [string, number][] {
  return Object.entries(stats.eventsByName).sort((a, b) => b[1] - a[1])
}

const EMPTY_STATS: AppEventStats = {
  appId: "",
  totalEvents: 0,
  eventsByName: {},
  firstEventAt: null,
  lastEventAt: null,
}

/**
 * Small stats panel for app analytics. Reads persisted events for `appId`
 * from localStorage and optionally lets visitors record demo events.
 *
 * localStorage is client-only, so stats load in an effect — the server and
 * the first client render both show the empty state, avoiding a hydration
 * mismatch (same pattern as `PermissionsManager`).
 */
export function AppAnalyticsStats({ appId, demo = false }: AppAnalyticsStatsProps) {
  const [stats, setStats] = useState<AppEventStats>(EMPTY_STATS)

  useEffect(() => {
    setStats(getAppStats(appId))
  }, [appId])

  const rows = statsToRows(stats)

  function trackDemo() {
    initAppAnalytics(appId).track("demo_event", { source: "developer-portal" })
    setStats(getAppStats(appId))
  }

  return (
    <div className="app-analytics-stats">
      <dl className="app-analytics-grid">
        <div>
          <dt>Total events</dt>
          <dd>{stats.totalEvents}</dd>
        </div>
        <div>
          <dt>Event types</dt>
          <dd>{rows.length}</dd>
        </div>
        <div>
          <dt>First event</dt>
          <dd>{formatTime(stats.firstEventAt)}</dd>
        </div>
        <div>
          <dt>Last event</dt>
          <dd>{formatTime(stats.lastEventAt)}</dd>
        </div>
      </dl>
      {rows.length > 0 ? (
        <table className="app-analytics-table">
          <thead>
            <tr>
              <th>Event</th>
              <th>Count</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([name, count]) => (
              <tr key={name}>
                <td>
                  <code>{name}</code>
                </td>
                <td>{count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="app-analytics-empty">No events recorded yet for this app.</p>
      )}
      {demo ? (
        <button type="button" className="btn btn--ghost" onClick={trackDemo}>
          Record a demo event
        </button>
      ) : null}
    </div>
  )
}
