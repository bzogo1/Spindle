"use client"

import { request } from "@/lib/api/client"
import { useApiQuery } from "@/lib/api/use-api-query"
import type { InvitationAnalytics } from "@/lib/invitation-analytics"
import { LoadingPanel } from "@/components/app/states/loading-panel"

/**
 * Invitation analytics panel (task 27) for the team members screen.
 *
 * Fetches `GET /api/invitations/analytics`, which aggregates the signed-in
 * user's own invitations server-side (status totals, acceptance rate,
 * time-to-accept, send windows, role mix, top domains). Rendered as a plain
 * `app-panel` section like the Members / Pending invites / Activity panels
 * around it.
 *
 * Failure posture matches the neighboring invite surfaces: the invitations
 * API is optional in local-preview mode, so a load error degrades to a muted
 * "unavailable" line instead of an error banner.
 */

interface AnalyticsResponse {
  ok: boolean
  analytics: InvitationAnalytics
}

const ROLE_ORDER = ["owner", "admin", "member"] as const

const ROLE_LABELS: Record<(typeof ROLE_ORDER)[number], string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
}

/** Compact duration for time-to-accept stats: "45m", "2h 15m", "3d 4h". */
export function formatDurationMs(ms: number | null): string {
  if (ms === null) return "—"
  if (ms < 60_000) return "<1m"
  const minutes = Math.round(ms / 60_000)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) {
    const remMinutes = minutes % 60
    return remMinutes === 0 ? `${hours}h` : `${hours}h ${remMinutes}m`
  }
  const days = Math.floor(hours / 24)
  const remHours = hours % 24
  return remHours === 0 ? `${days}d` : `${days}d ${remHours}h`
}

function formatRate(rate: number | null): string {
  return rate === null ? "—" : `${Math.round(rate * 100)}%`
}

function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="app-stat-card">
      <span>{label}</span>
      <strong>{value}</strong>
      {hint ? <small>{hint}</small> : null}
    </div>
  )
}

function breakdownRowStyle() {
  return {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    padding: "6px 0",
    fontSize: 13,
  } as const
}

function InvitationAnalyticsBody({ analytics }: { analytics: InvitationAnalytics }) {
  const { byStatus, timeToAccept } = analytics

  return (
    <div className="app-usage-grid">
      <div
        className="app-stat-grid"
        style={{ gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))" }}
      >
        <StatCard label="Total invites" value={analytics.total.toLocaleString()} />
        <StatCard label="Pending" value={byStatus.pending.toLocaleString()} />
        <StatCard label="Accepted" value={byStatus.accepted.toLocaleString()} />
        <StatCard
          label="Acceptance rate"
          value={formatRate(analytics.acceptanceRate)}
          hint="accepted ÷ total"
        />
        <StatCard
          label="Median time to accept"
          value={formatDurationMs(timeToAccept.medianMs)}
          hint={
            timeToAccept.sampleSize > 0
              ? `avg ${formatDurationMs(timeToAccept.averageMs)} · n=${timeToAccept.sampleSize}`
              : "no acceptances yet"
          }
        />
        <StatCard label="Sent · 7 days" value={analytics.sent.last7Days.toLocaleString()} />
        <StatCard label="Sent · 30 days" value={analytics.sent.last30Days.toLocaleString()} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <h3 className="text-muted-foreground mb-2 text-sm font-semibold">By role · all time</h3>
          <ul className="m-0 list-none p-0">
            {ROLE_ORDER.map((role) => (
              <li key={role} style={breakdownRowStyle()}>
                <span>{ROLE_LABELS[role]}</span>
                <strong style={{ fontVariantNumeric: "tabular-nums" }}>
                  {analytics.roles[role]}
                </strong>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className="text-muted-foreground mb-2 text-sm font-semibold">Top invited domains</h3>
          {analytics.topDomains.length === 0 ? (
            <p className="text-muted-foreground m-0 text-sm">No invitations yet.</p>
          ) : (
            <ul className="m-0 list-none p-0">
              {analytics.topDomains.map((entry) => (
                <li key={entry.domain} style={breakdownRowStyle()}>
                  <span>{entry.domain}</span>
                  <strong style={{ fontVariantNumeric: "tabular-nums" }}>{entry.count}</strong>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}

export function InvitationAnalyticsPanel() {
  const query = useApiQuery(
    (options) =>
      request<AnalyticsResponse>("", "/api/invitations/analytics", { signal: options.signal }),
    [],
  )

  const analytics = query.data?.analytics

  return (
    <section className="app-panel" aria-labelledby="invitation-analytics-heading">
      <div className="app-panel-head">
        <div>
          <h2 id="invitation-analytics-heading">Invitation analytics</h2>
          <p>How the invites you sent are doing — acceptance, timing, and who they went to.</p>
        </div>
      </div>

      {query.status === "loading" || query.status === "idle" ? (
        <LoadingPanel label="Loading invitation analytics" variant="lines" lines={2} />
      ) : query.status === "error" || !analytics ? (
        <p className="app-panel-empty">Invitation analytics are unavailable right now.</p>
      ) : (
        <InvitationAnalyticsBody analytics={analytics} />
      )}
    </section>
  )
}
