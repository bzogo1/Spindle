"use client"

import { useState, type CSSProperties } from "react"
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"

import { request } from "@/lib/api/client"
import { useApiQuery } from "@/lib/api/use-api-query"
import type {
  ContactAnalyticsSummary,
  ContactDailyPoint,
  QueueBreakdownEntry,
} from "@/lib/contact-analytics"
import { LoadingPanel } from "@/components/app/states/loading-panel"
import { QueryState } from "@/components/app/states/query-state"
import { Button } from "@/components/ui/button"

/**
 * Contact-form analytics panel for `/app/admin/contact` (task 75).
 *
 * Fetches `GET /api/admin/contact/analytics?days=` and renders stat cards
 * (total / new / in-progress / resolved / spam share), a per-queue breakdown,
 * and a daily submission-volume bar chart over the last `days` UTC days.
 *
 * The endpoint aggregates the in-memory submission store in
 * `src/lib/contact-routing.ts`, so these numbers cover only the submissions
 * currently retained on this instance — not durable history.
 *
 * Queue labels mirror `CONTACT_QUEUE_LABELS` in `src/lib/contact-routing.ts`,
 * which is server-only (it pulls in zod via `site-forms`), so the map is
 * duplicated here — keep it in sync when queues change.
 */

interface ContactAnalyticsResponse {
  ok: boolean
  summary: ContactAnalyticsSummary
  queueBreakdown: QueueBreakdownEntry[]
  daily: ContactDailyPoint[]
  days: number
  generatedAt: string
}

const DAY_OPTIONS = [7, 30, 90] as const
const DEFAULT_DAYS = 30

/** Mirrors CONTACT_QUEUE_LABELS in lib/contact-routing. */
const QUEUE_LABELS: Record<string, string> = {
  support: "Support",
  sales: "Sales",
  billing: "Billing",
  security: "Security",
  press: "Press",
  general: "General",
}

const CHART_AXIS_TICK = { fontSize: 11, fill: "var(--app-text-muted)" } as const

const CHART_TOOLTIP_STYLE: CSSProperties = {
  background: "var(--app-panel)",
  border: "1px solid var(--app-border)",
  borderRadius: 8,
  color: "var(--app-text)",
  fontSize: 12,
}

const queueListStyle: CSSProperties = {
  display: "grid",
  gap: 10,
  margin: 0,
  padding: 0,
  listStyle: "none",
}

const queueRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  justifyContent: "space-between",
  gap: 12,
  fontSize: 13,
}

const queueBarTrackStyle: CSSProperties = {
  height: 6,
  borderRadius: 999,
  background: "var(--app-border)",
  overflow: "hidden",
  marginTop: 4,
}

function formatDayTick(value: string) {
  const date = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" })
}

function statusCount(summary: ContactAnalyticsSummary, status: string): number {
  return summary.byStatus.find((entry) => entry.key === status)?.count ?? 0
}

/** Share of `total` as a one-decimal percentage string ("33.3%"). */
function formatShare(count: number, total: number): string {
  if (total === 0) return "0%"
  const percent = Math.round((count / total) * 1000) / 10
  return `${percent}%`
}

function queueLabel(queue: string): string {
  return QUEUE_LABELS[queue] ?? queue
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

function AnalyticsBody({
  summary,
  queueBreakdown,
  daily,
}: {
  summary: ContactAnalyticsSummary
  queueBreakdown: QueueBreakdownEntry[]
  daily: ContactDailyPoint[]
}) {
  const total = summary.total

  return (
    <div className="app-usage-grid">
      <div
        className="app-stat-grid"
        style={{ gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))" }}
      >
        <StatCard label="Total submissions" value={total.toLocaleString()} />
        <StatCard label="New" value={statusCount(summary, "new").toLocaleString()} />
        <StatCard
          label="In progress"
          value={statusCount(summary, "in_progress").toLocaleString()}
        />
        <StatCard label="Resolved" value={statusCount(summary, "resolved").toLocaleString()} />
        <StatCard
          label="Spam share"
          value={formatShare(statusCount(summary, "spam"), total)}
          hint={`${statusCount(summary, "spam").toLocaleString()} flagged`}
        />
      </div>

      <div className="app-usage-chart-plot">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={daily} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="var(--app-border)" vertical={false} />
            <XAxis
              dataKey="date"
              tickFormatter={formatDayTick}
              tick={CHART_AXIS_TICK}
              tickLine={false}
              axisLine={false}
              interval="equidistantPreserveStart"
              minTickGap={24}
            />
            <YAxis
              tick={CHART_AXIS_TICK}
              tickLine={false}
              axisLine={false}
              width={32}
              allowDecimals={false}
              tickFormatter={(value: number) => value.toLocaleString()}
            />
            <Tooltip
              labelFormatter={(label) => formatDayTick(String(label))}
              formatter={(value) => (value == null ? "" : Number(value).toLocaleString())}
              contentStyle={CHART_TOOLTIP_STYLE}
            />
            <Bar
              dataKey="count"
              name="Submissions"
              fill="var(--app-accent)"
              fillOpacity={0.85}
              radius={[3, 3, 0, 0]}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div>
        <h3
          style={{
            margin: "0 0 8px",
            fontSize: 13,
            fontWeight: 600,
            color: "var(--app-text-muted)",
          }}
        >
          Queue breakdown
        </h3>
        {queueBreakdown.length === 0 ? (
          <p className="text-muted-foreground m-0 text-sm">No submissions yet.</p>
        ) : (
          <ul style={queueListStyle}>
            {queueBreakdown.map((entry) => (
              <li key={entry.key}>
                <div style={queueRowStyle}>
                  <span>{queueLabel(entry.key)}</span>
                  <strong style={{ fontVariantNumeric: "tabular-nums" }}>
                    {entry.count.toLocaleString()} · {entry.percent}%
                  </strong>
                </div>
                <div style={queueBarTrackStyle} aria-hidden="true">
                  <div
                    style={{
                      height: "100%",
                      width: `${Math.min(100, Math.max(0, entry.percent))}%`,
                      borderRadius: 999,
                      background: "var(--app-accent)",
                    }}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

export function ContactAnalyticsPanel() {
  const [days, setDays] = useState<number>(DEFAULT_DAYS)

  const query = useApiQuery(
    (options) =>
      request<ContactAnalyticsResponse>("", `/api/admin/contact/analytics?days=${days}`, {
        signal: options.signal,
      }),
    [days],
  )

  const analytics = query.data
  const isEmpty =
    analytics !== undefined &&
    analytics.summary.total === 0 &&
    analytics.queueBreakdown.length === 0

  return (
    <section className="app-panel" aria-labelledby="contact-analytics-heading">
      <div className="app-panel-head">
        <div>
          <h2 id="contact-analytics-heading">Contact analytics</h2>
          <p>
            Aggregated over the contact submissions retained in memory — per-instance, bounded, and
            lost on restart.
          </p>
        </div>
        <div className="app-toolbar" role="group" aria-label="Analytics range">
          {DAY_OPTIONS.map((option) => (
            <Button
              key={option}
              type="button"
              size="xs"
              variant={days === option ? "secondary" : "outline"}
              aria-pressed={days === option}
              onClick={() => setDays(option)}
            >
              {option}d
            </Button>
          ))}
        </div>
      </div>

      <QueryState<ContactAnalyticsResponse>
        status={query.status === "idle" ? "loading" : query.status}
        data={analytics}
        error={query.error}
        isEmpty={isEmpty}
        isRetrying={query.isRetrying}
        onRetry={query.refetch}
        loading={<LoadingPanel label="Loading contact analytics" variant="lines" lines={2} />}
        emptyTitle="No contact submissions yet"
        emptyBody="Analytics appear here once visitors submit the public contact form."
        errorTitle="Contact analytics did not load"
        errorMessage="We could not load the contact analytics. Try again to refresh the numbers."
      >
        {(data) => (
          <AnalyticsBody
            summary={data.summary}
            queueBreakdown={data.queueBreakdown}
            daily={data.daily}
          />
        )}
      </QueryState>
    </section>
  )
}

export default ContactAnalyticsPanel
