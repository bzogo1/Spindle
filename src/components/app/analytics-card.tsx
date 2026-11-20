"use client"

import { useState, type CSSProperties } from "react"
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"

import { request } from "@/lib/api/client"
import { useApiQuery } from "@/lib/api/use-api-query"
import type { AnalyticsSummary } from "@/lib/analytics"
import { Button } from "@/components/ui/button"
import { LoadingPanel } from "@/components/app/states/loading-panel"
import { QueryState } from "@/components/app/states/query-state"

/**
 * Product-analytics widget for the dashboard. Shows the signed-in user's own
 * consented events — page views, feature uses, and API calls — aggregated by
 * `GET /api/analytics/summary` over the in-memory store in
 * `src/lib/analytics.ts`.
 *
 * Complements `usage-screen.tsx` (billing/plan meters): this card is about
 * product interaction, not metered quota. Both loading and error states go
 * through the shared `QueryState`/`LoadingPanel` primitives, and the chart
 * follows the same recharts conventions as the usage charts.
 */

interface SummaryResponse {
  ok: boolean
  summary: AnalyticsSummary
}

const DAY_OPTIONS = [7, 30] as const

const CHART_AXIS_TICK = { fontSize: 11, fill: "var(--app-text-muted)" } as const

const CHART_TOOLTIP_STYLE: CSSProperties = {
  background: "var(--app-panel)",
  border: "1px solid var(--app-border)",
  borderRadius: 8,
  color: "var(--app-text)",
  fontSize: 12,
}

const topListStyle: CSSProperties = {
  display: "grid",
  gap: 8,
  margin: "14px 0 0",
  padding: 0,
  listStyle: "none",
}

const topRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  padding: "8px 10px",
  border: "1px solid var(--app-border)",
  borderRadius: 8,
}

function formatDayTick(value: string) {
  const date = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" })
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="app-stat-card">
      <span>{label}</span>
      <strong>{value.toLocaleString()}</strong>
    </div>
  )
}

function AnalyticsSummaryView({ summary }: { summary: AnalyticsSummary }) {
  const { totals } = summary
  return (
    <div className="app-usage-grid">
      <div className="app-stat-grid" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
        <StatCard label="Events" value={totals.events} />
        <StatCard label="Page views" value={totals.pageViews} />
        <StatCard label="Feature uses" value={totals.featureUses} />
        <StatCard label="API calls" value={totals.apiCalls} />
      </div>

      <div className="app-usage-chart-plot">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={summary.daily} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
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
            <Area
              type="monotone"
              dataKey="events"
              name="Events"
              stroke="var(--app-accent)"
              fill="var(--app-accent)"
              fillOpacity={0.16}
              strokeWidth={2}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {summary.topEvents.length > 0 ? (
        <div>
          <h3
            style={{
              margin: "0 0 8px",
              fontSize: 13,
              fontWeight: 600,
              color: "var(--app-text-muted)",
            }}
          >
            Top events · last {summary.days} days
          </h3>
          <ul style={topListStyle}>
            {summary.topEvents.map((entry) => (
              <li key={`${entry.type}:${entry.name}`} style={topRowStyle}>
                <span>
                  {entry.name}
                  <span
                    style={{
                      marginLeft: 8,
                      fontSize: 11,
                      color: "var(--app-text-muted)",
                      textTransform: "uppercase",
                      letterSpacing: "0.04em",
                    }}
                  >
                    {entry.type.replace("_", " ")}
                  </span>
                </span>
                <strong style={{ fontVariantNumeric: "tabular-nums" }}>{entry.count}</strong>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}

export function AnalyticsCard() {
  const [days, setDays] = useState<number>(30)

  const query = useApiQuery(
    (options) =>
      request<SummaryResponse>("", `/api/analytics/summary?days=${days}`, {
        signal: options.signal,
      }),
    [days],
  )

  const summary = query.data?.summary
  const isEmpty = summary !== undefined && summary.totals.events === 0

  return (
    <section className="app-panel" aria-labelledby="analytics-card-heading">
      <div className="app-panel-head">
        <div>
          <h2 id="analytics-card-heading">Product analytics</h2>
          <p>
            Your consented in-app events — page views, feature uses, and API calls — aggregated over
            the last {days} days.
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

      <QueryState<AnalyticsSummary>
        status={query.status === "idle" ? "loading" : query.status}
        data={summary}
        error={query.error}
        isEmpty={isEmpty}
        isRetrying={query.isRetrying}
        onRetry={query.refetch}
        loading={<LoadingPanel label="Loading analytics" variant="lines" lines={2} />}
        emptyTitle="No analytics events yet"
        emptyBody="Events appear here once analytics cookies are allowed and you use the app."
        errorTitle="Analytics did not load"
        errorMessage="We could not load your usage analytics. Try again to refresh the numbers."
      >
        {(data) => <AnalyticsSummaryView summary={data} />}
      </QueryState>
    </section>
  )
}

export default AnalyticsCard
