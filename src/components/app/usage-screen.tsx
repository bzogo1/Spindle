"use client"

import type { CSSProperties, ReactNode } from "react"
import Link from "next/link"
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import { ArrowUpRight, Check, Download, X } from "lucide-react"

import { formatDate } from "@/components/app/format"
import { MOCK_BILLING_PLAN, MOCK_INVOICES } from "@/components/app/billing-mock"
import type { Invoice } from "@/components/app/billing-mock"
import { LoadingPanel } from "@/components/app/states/loading-panel"
import { QueryState } from "@/components/app/states/query-state"
import { UsageAlertsPanel } from "@/components/app/usage-alerts"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { useUsageSummary } from "@/lib/api"
import type { UsageComparison, UsageSummary } from "@/lib/api/types"

/**
 * Usage and plan overview. Requests, tokens, cost, and the billing period
 * come from `useUsageSummary` (the `/usage/summary` endpoint) and are wired
 * into the billing cards: the plan card shows the live billing period and an
 * estimated next invoice (seat price + metered usage), and the billing
 * history table flags the invoice that covers the current usage period.
 * Plan, seat, storage, agent-run, and invoice figures are mock fixtures in
 * `billing-mock.ts` — the billing API does not exist yet, so those constants
 * are the single place to swap for real values later.
 */

const PLAN = MOCK_BILLING_PLAN

function formatUsd(value: number) {
  return `$${value.toFixed(2)}`
}

type MeterStatus = "ok" | "warning" | "blocked"

interface UsageMeter {
  id: string
  label: string
  usedLabel: string
  limitLabel: string
  percent: number
  detail: string
}

const USAGE_METERS: UsageMeter[] = [
  {
    id: "storage",
    label: "Storage (placeholder)",
    usedLabel: "4.7 GB",
    limitLabel: "5 GB",
    percent: 94,
    detail:
      "Placeholder values — the usage API does not expose storage yet. Real storage figures arrive with the billing API.",
  },
  {
    id: "agent-runs",
    label: "Agent runs today (placeholder)",
    usedLabel: "26",
    limitLabel: "20",
    percent: 130,
    detail: "Placeholder values — agent-run caps are plan data and arrive with the billing API.",
  },
  {
    id: "seats",
    label: "Seats (placeholder)",
    usedLabel: "3",
    limitLabel: "5",
    percent: 60,
    detail: "Placeholder values — seat counts are plan data and arrive with the billing API.",
  },
]

const METER_STATUS_LABEL: Record<MeterStatus, string> = {
  ok: "Healthy",
  warning: "Near limit",
  blocked: "Limit reached",
}

function meterStatus(percent: number): MeterStatus {
  if (percent >= 100) return "blocked"
  if (percent >= 80) return "warning"
  return "ok"
}

const PLAN_FEATURES = [
  { feature: "Storage", hobby: "5 GB", team: "100 GB", enterprise: "Unlimited" },
  { feature: "Agent requests", hobby: "20 per day", team: "Unlimited", enterprise: "Unlimited" },
  { feature: "Seats", hobby: "1", team: "5", enterprise: "Unlimited" },
  { feature: "Lab, Search, Files, Agent, Chat", hobby: true, team: true, enterprise: true },
  { feature: "Automations and cron jobs", hobby: true, team: true, enterprise: true },
  { feature: "Dedicated infrastructure and SLA", hobby: false, team: false, enterprise: true },
  { feature: "Onboarding and training", hobby: false, team: false, enterprise: true },
  {
    feature: "Countersigned DPA and subprocessor list",
    hobby: false,
    team: false,
    enterprise: true,
  },
] as const

const INVOICES = MOCK_INVOICES

/** True when the invoice's billing period matches the loaded usage period. */
function coversUsagePeriod(invoice: Invoice, usage: UsageSummary | undefined) {
  return (
    usage !== undefined &&
    invoice.periodStart === usage.periodStart &&
    invoice.periodEnd === usage.periodEnd
  )
}

/** Seat subtotal plus metered usage — the mock estimate for the next invoice. */
function estimatedInvoiceUsd(usage: UsageSummary | undefined) {
  if (usage === undefined) return undefined
  return estimatedInvoiceForCost(usage.costUsd)
}

/** Seat subtotal plus a metered cost figure — shared by live and forecast estimates. */
function estimatedInvoiceForCost(costUsd: number) {
  return PLAN.seatsUsed * PLAN.pricePerSeatUsd + costUsd
}

const DAY_MS = 24 * 60 * 60 * 1000

/** UTC midnight (ms) of the calendar day containing an ISO timestamp or Date. */
function utcDayStart(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return Number.NaN
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
}

/** Per-project run-rate projection, mirroring `UsageProjectBreakdown`. */
export interface UsageForecastProject {
  projectId: string
  projectName: string
  requests: number
  tokens: number
  costUsd: number
}

export interface UsageForecast {
  /** Calendar days in the billing period. */
  periodDays: number
  /** Days elapsed in the period at `now`, capped at `periodDays`. */
  elapsedDays: number
  /** Mean daily usage across the elapsed days (days without traffic count as zero). */
  requestsPerDay: number
  tokensPerDay: number
  costUsdPerDay: number
  /** Period-end projection if the current daily pace holds. */
  requests: number
  tokens: number
  costUsd: number
  /**
   * Same run-rate projection per project. `UsageSummary.projects` carries
   * whole-period totals while the daily series only sums days ≤ `now`, so
   * each project is expressed as its share of the period totals applied to
   * the daily-based projection above — not by scaling raw totals directly.
   * Empty when the summary has none.
   */
  projects: UsageForecastProject[]
}

/**
 * Linear run-rate forecast: sums the daily series up to `now` (future-dated
 * points are ignored), divides by the elapsed calendar days, and projects
 * that pace across the whole billing period. Per-project figures use each
 * project's share of the `UsageSummary` totals applied to that projection,
 * keeping them on the same observed-days basis as the period forecast.
 * Returns null when the period has not started or the summary carries no
 * daily series to pace from.
 */
export function usageForecast(usage: UsageSummary, now: Date = new Date()): UsageForecast | null {
  if (usage.daily.length === 0) return null

  const periodStartDay = utcDayStart(usage.periodStart)
  const periodEndDay = utcDayStart(usage.periodEnd)
  const todayDay = utcDayStart(now)
  if (
    Number.isNaN(periodStartDay) ||
    Number.isNaN(periodEndDay) ||
    Number.isNaN(todayDay) ||
    periodEndDay < periodStartDay
  ) {
    return null
  }

  const periodDays = Math.round((periodEndDay - periodStartDay) / DAY_MS) + 1
  const lastObservedDay = Math.min(todayDay, periodEndDay)
  const elapsedDays =
    lastObservedDay < periodStartDay
      ? 0
      : Math.round((lastObservedDay - periodStartDay) / DAY_MS) + 1
  if (elapsedDays <= 0) return null

  const observed = usage.daily.filter((point) => {
    const day = utcDayStart(point.date)
    return !Number.isNaN(day) && day >= periodStartDay && day <= lastObservedDay
  })
  const observedRequests = observed.reduce((sum, point) => sum + point.requests, 0)
  const observedTokens = observed.reduce((sum, point) => sum + point.tokens, 0)
  const observedCostUsd = observed.reduce((sum, point) => sum + point.costUsd, 0)

  const paceFactor = periodDays / elapsedDays
  const projectedRequests = observedRequests * paceFactor
  const projectedTokens = observedTokens * paceFactor
  const projectedCostUsd = observedCostUsd * paceFactor

  // Project breakdown totals cover the whole billing period, while the daily
  // series above only sums days ≤ `now`. Convert each project into its share
  // of the period totals, then apply that share to the daily-based projection
  // so per-project forecasts sit on the same observed-days basis.
  const shareOf = (part: number, whole: number) => (whole > 0 ? part / whole : 0)
  const projects = (usage.projects ?? []).map((project) => ({
    projectId: project.projectId,
    projectName: project.projectName,
    requests: Math.round(projectedRequests * shareOf(project.requests, usage.requests)),
    tokens: Math.round(projectedTokens * shareOf(project.tokens, usage.tokens)),
    costUsd: Math.round(projectedCostUsd * shareOf(project.costUsd, usage.costUsd) * 100) / 100,
  }))

  return {
    periodDays,
    elapsedDays,
    requestsPerDay: observedRequests / elapsedDays,
    tokensPerDay: observedTokens / elapsedDays,
    costUsdPerDay: observedCostUsd / elapsedDays,
    requests: Math.round(projectedRequests),
    tokens: Math.round(projectedTokens),
    costUsd: Math.round(projectedCostUsd * 100) / 100,
    projects,
  }
}

function UsageTotals({ usage }: { usage: UsageSummary }) {
  return (
    <dl className="app-storage-breakdown">
      <div>
        <dt>Requests</dt>
        <dd>{usage.requests.toLocaleString()}</dd>
      </div>
      <div>
        <dt>Tokens</dt>
        <dd>{usage.tokens.toLocaleString()}</dd>
      </div>
      <div>
        <dt>Cost</dt>
        <dd>${usage.costUsd.toFixed(2)}</dd>
      </div>
      <div>
        <dt>Period</dt>
        <dd>
          {formatDate(usage.periodStart)} – {formatDate(usage.periodEnd)}
        </dd>
      </div>
    </dl>
  )
}

const CHART_AXIS_TICK = { fontSize: 11, fill: "var(--app-text-muted)" } as const

const CHART_TOOLTIP_STYLE: CSSProperties = {
  background: "var(--app-panel)",
  border: "1px solid var(--app-border)",
  borderRadius: 8,
  color: "var(--app-text)",
  fontSize: 12,
}

function formatDayTick(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

function formatCountTick(value: number) {
  return value.toLocaleString()
}

function formatCostTick(value: number) {
  return `$${value.toFixed(2)}`
}

function ChartFrame({
  id,
  title,
  subtitle,
  children,
}: {
  id: string
  title: string
  subtitle: string
  children: ReactNode
}) {
  return (
    <section className="app-panel" aria-labelledby={id}>
      <div className="app-panel-head">
        <div>
          <h2 id={id}>{title}</h2>
          <p>{subtitle}</p>
        </div>
      </div>
      <div className="app-usage-chart-plot">{children}</div>
    </section>
  )
}

function UsageAnalytics({ usage }: { usage: UsageSummary }) {
  const points = usage.daily
  if (points.length === 0) {
    return <p className="app-field-hint">Daily usage breakdown is not available yet.</p>
  }

  // Dashed run-rate reference on the requests chart: the mean daily pace the
  // forecast panel projects to period end. Null when the period hasn't started.
  const forecast = usageForecast(usage)
  const pace = forecast === null ? null : Math.round(forecast.requestsPerDay)
  const chartPoints = points.map((point) => ({ ...point, pace }))

  return (
    <div className="app-usage-grid">
      <ChartFrame
        id="usage-requests-chart"
        title="Requests per day"
        subtitle="Agent, chat, and API requests across the billing period."
      >
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartPoints} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
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
              width={44}
              allowDecimals={false}
              tickFormatter={formatCountTick}
            />
            <Tooltip
              labelFormatter={(label) => formatDayTick(String(label))}
              formatter={(value) => (value == null ? "" : Number(value).toLocaleString())}
              contentStyle={CHART_TOOLTIP_STYLE}
            />
            <Area
              type="monotone"
              dataKey="requests"
              name="Requests"
              stroke="var(--app-accent)"
              fill="var(--app-accent)"
              fillOpacity={0.16}
              strokeWidth={2}
            />
            {pace === null ? null : (
              <Line
                type="monotone"
                dataKey="pace"
                name="Avg daily pace"
                stroke="var(--app-text-muted)"
                strokeWidth={2}
                strokeDasharray="5 4"
                dot={false}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </ChartFrame>

      <ChartFrame
        id="usage-tokens-chart"
        title="Tokens per day"
        subtitle="Tokens consumed by requests across the billing period."
      >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
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
              width={44}
              allowDecimals={false}
              tickFormatter={formatCountTick}
            />
            <Tooltip
              labelFormatter={(label) => formatDayTick(String(label))}
              formatter={(value) => (value == null ? "" : Number(value).toLocaleString())}
              contentStyle={CHART_TOOLTIP_STYLE}
            />
            <Line
              type="monotone"
              dataKey="tokens"
              name="Tokens"
              stroke="var(--mint)"
              strokeWidth={2}
              dot={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </ChartFrame>

      <ChartFrame
        id="usage-cost-chart"
        title="Cost per day"
        subtitle="Estimated spend per day at the blended token rate."
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
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
              width={48}
              tickFormatter={formatCostTick}
            />
            <Tooltip
              labelFormatter={(label) => formatDayTick(String(label))}
              formatter={(value) => (value == null ? "" : `$${Number(value).toFixed(2)}`)}
              contentStyle={CHART_TOOLTIP_STYLE}
            />
            <Bar
              dataKey="costUsd"
              name="Cost"
              fill="var(--amber)"
              fillOpacity={0.85}
              radius={[3, 3, 0, 0]}
            />
          </BarChart>
        </ResponsiveContainer>
      </ChartFrame>
    </div>
  )
}

/**
 * Period-end projection from the daily run-rate. Renders the pace, the
 * forecast totals, the estimated invoice at that pace, and — when the plan
 * defines monthly quotas — how the forecast compares to them. Renders
 * nothing when the period hasn't started or there is no daily series.
 */
function UsageForecastSection({ usage }: { usage: UsageSummary }) {
  const forecast = usageForecast(usage)
  if (!forecast) return null

  const requestLimit = PLAN.monthlyRequestLimit
  const costLimit = PLAN.monthlyCostLimitUsd
  const hasLimits = requestLimit !== undefined || costLimit !== undefined

  return (
    <section className="app-panel" aria-labelledby="usage-forecast-heading">
      <div className="app-panel-head">
        <div>
          <h2 id="usage-forecast-heading">Usage forecast</h2>
          <p>
            Linear run-rate over {forecast.elapsedDays} of {forecast.periodDays} days in the billing
            period — days without traffic count as zero.
          </p>
        </div>
      </div>
      <dl className="app-storage-breakdown">
        <div>
          <dt>Daily pace</dt>
          <dd>
            ~{Math.round(forecast.requestsPerDay).toLocaleString()} requests · ~
            {Math.round(forecast.tokensPerDay).toLocaleString()} tokens ·{" "}
            {formatUsd(forecast.costUsdPerDay)}
          </dd>
        </div>
        <div>
          <dt>Forecast by period end</dt>
          <dd>
            ~{forecast.requests.toLocaleString()} requests · ~{forecast.tokens.toLocaleString()}{" "}
            tokens · {formatUsd(forecast.costUsd)}
          </dd>
        </div>
        <div>
          <dt>Est. invoice at this pace</dt>
          <dd>{formatUsd(estimatedInvoiceForCost(forecast.costUsd))}</dd>
        </div>
        {requestLimit !== undefined ? (
          <div>
            <dt>Forecast vs request limit</dt>
            <dd>
              {forecast.requests.toLocaleString()} of {requestLimit.toLocaleString()} (
              {((forecast.requests / requestLimit) * 100).toFixed(0)}%)
            </dd>
          </div>
        ) : null}
        {costLimit !== undefined ? (
          <div>
            <dt>Forecast vs cost limit</dt>
            <dd>
              {formatUsd(forecast.costUsd)} of {formatUsd(costLimit)} (
              {((forecast.costUsd / costLimit) * 100).toFixed(0)}%)
            </dd>
          </div>
        ) : null}
      </dl>
      <p className="app-field-hint">
        {hasLimits
          ? "Forecast compared against the plan's monthly usage limits."
          : "The current plan has no metered usage cap, so the forecast is informational. Plan, seat, and invoice figures are mock fixtures."}
      </p>
    </section>
  )
}

/** Signed percent change vs the previous period; "—" when there is no baseline. */
function formatDeltaPercent(current: number, previous: number) {
  if (previous === 0) return current === 0 ? "0.0%" : "—"
  const delta = ((current - previous) / previous) * 100
  const sign = delta > 0 ? "+" : delta < 0 ? "−" : ""
  return `${sign}${Math.abs(delta).toFixed(1)}%`
}

interface ComparisonRow {
  label: string
  current: number
  previous: number
  format: (value: number) => string
}

/** Per-day requests for both periods, aligned by day-of-period index. */
function comparisonChartPoints(usage: UsageSummary, comparison: UsageComparison) {
  const length = Math.max(usage.daily.length, comparison.daily.length)
  return Array.from({ length }, (_, index) => ({
    day: index + 1,
    current: usage.daily[index]?.requests ?? null,
    previous: comparison.daily[index]?.requests ?? null,
  }))
}

/**
 * Month-over-month view: a delta table for the period totals plus a chart
 * overlaying the daily request series of the current and previous periods.
 * Renders nothing when the summary carries no `comparison` payload.
 */
function UsageComparisonSection({ usage }: { usage: UsageSummary }) {
  const comparison = usage.comparison
  if (!comparison) return null

  const rows: ComparisonRow[] = [
    {
      label: "Requests",
      current: usage.requests,
      previous: comparison.requests,
      format: (value) => value.toLocaleString(),
    },
    {
      label: "Tokens",
      current: usage.tokens,
      previous: comparison.tokens,
      format: (value) => value.toLocaleString(),
    },
    {
      label: "Cost",
      current: usage.costUsd,
      previous: comparison.costUsd,
      format: formatUsd,
    },
  ]

  const chartPoints = comparisonChartPoints(usage, comparison)
  const hasChartData = chartPoints.some(
    (point) => point.current !== null || point.previous !== null,
  )

  return (
    <div className="app-usage-grid">
      <section className="app-panel" aria-labelledby="usage-comparison-heading">
        <div className="app-panel-head">
          <div>
            <h2 id="usage-comparison-heading">Month over month</h2>
            <p>
              This period vs {formatDate(comparison.periodStart)} –{" "}
              {formatDate(comparison.periodEnd)}.
            </p>
          </div>
        </div>
        <div className="app-table-wrap">
          <table className="app-data-table">
            <thead>
              <tr>
                <th scope="col">Metric</th>
                <th scope="col">This period</th>
                <th scope="col">Previous period</th>
                <th scope="col">Change</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.label}>
                  <th scope="row">{row.label}</th>
                  <td>{row.format(row.current)}</td>
                  <td>{row.format(row.previous)}</td>
                  <td className="app-usage-delta">
                    {formatDeltaPercent(row.current, row.previous)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {hasChartData ? (
        <ChartFrame
          id="usage-comparison-chart"
          title="Requests vs previous period"
          subtitle="Per-day requests aligned by day of the billing period."
        >
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartPoints} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid stroke="var(--app-border)" vertical={false} />
              <XAxis
                dataKey="day"
                tickFormatter={(value) => `Day ${value}`}
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
                width={44}
                allowDecimals={false}
                tickFormatter={formatCountTick}
              />
              <Tooltip
                labelFormatter={(label) => `Day ${label}`}
                formatter={(value, name) => [
                  value == null ? "—" : Number(value).toLocaleString(),
                  String(name),
                ]}
                contentStyle={CHART_TOOLTIP_STYLE}
              />
              <Line
                type="monotone"
                dataKey="current"
                name="This period"
                stroke="var(--app-accent)"
                strokeWidth={2}
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="previous"
                name="Previous period"
                stroke="var(--app-text-muted)"
                strokeWidth={2}
                strokeDasharray="5 4"
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </ChartFrame>
      ) : null}
    </div>
  )
}

/**
 * Per-project usage breakdown for the billing period. Rows come from
 * `UsageSummary.projects`; the panel renders nothing when the summary
 * carries no per-project data. Project names link to the project home.
 */
function UsageByProject({ usage }: { usage: UsageSummary }) {
  const projects = usage.projects
  if (!projects || projects.length === 0) return null

  const rows = [...projects].sort((a, b) => b.requests - a.requests)
  // Per-project forecasts come from `usageForecast` (each project's share of
  // the period totals applied to the daily run-rate); "—" until it resolves.
  const forecastById = new Map(
    (usageForecast(usage)?.projects ?? []).map((project) => [project.projectId, project]),
  )

  return (
    <section className="app-panel" aria-labelledby="usage-by-project-heading">
      <div className="app-panel-head">
        <div>
          <h2 id="usage-by-project-heading">Usage by project</h2>
          <p>
            Requests, tokens, and estimated cost per project this billing period, with the
            period-end run-rate forecast.
          </p>
        </div>
      </div>
      <div className="app-table-wrap">
        <table className="app-data-table">
          <thead>
            <tr>
              <th scope="col">Project</th>
              <th scope="col">Requests</th>
              <th scope="col">Tokens</th>
              <th scope="col">Cost</th>
              <th scope="col">Share of requests</th>
              <th scope="col">Forecast requests</th>
              <th scope="col">Forecast cost</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((project) => {
              const share = usage.requests > 0 ? (project.requests / usage.requests) * 100 : 0
              const forecast = forecastById.get(project.projectId)
              return (
                <tr key={project.projectId}>
                  <th scope="row">
                    <Link href={`/projects/${project.projectId}`}>{project.projectName}</Link>
                  </th>
                  <td>{project.requests.toLocaleString()}</td>
                  <td>{project.tokens.toLocaleString()}</td>
                  <td>{formatUsd(project.costUsd)}</td>
                  <td className="app-usage-delta">{share.toFixed(1)}%</td>
                  <td>{forecast ? forecast.requests.toLocaleString() : "—"}</td>
                  <td>{forecast ? formatUsd(forecast.costUsd) : "—"}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function FeatureCell({ value, current = false }: { value: string | boolean; current?: boolean }) {
  const className = current ? "is-current" : undefined
  if (typeof value === "string") return <td className={className}>{value}</td>
  return (
    <td className={className}>
      {value ? (
        <Check className="app-usage-check" aria-label="Included" />
      ) : (
        <X className="app-usage-check app-usage-check--off" aria-label="Not included" />
      )}
    </td>
  )
}

function invoiceCsv() {
  const rows = INVOICES.map((invoice) =>
    [
      invoice.id,
      invoice.date,
      invoice.periodStart.slice(0, 10),
      invoice.periodEnd.slice(0, 10),
      invoice.description,
      formatUsd(invoice.amountUsd),
      invoice.status,
    ]
      .map((cell) => `"${cell.replaceAll('"', '""')}"`)
      .join(","),
  )
  return ["Invoice,Date,Period start,Period end,Description,Amount,Status", ...rows].join("\n")
}

function exportInvoicesCsv() {
  const blob = new Blob([invoiceCsv()], { type: "text/csv;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = "spindle-invoices.csv"
  anchor.click()
  URL.revokeObjectURL(url)
}

function csvCell(cell: string | number) {
  return `"${String(cell).replaceAll('"', '""')}"`
}

/**
 * Usage export payload as CSV: a `metric,value` summary block for the billing
 * period totals, a blank line, then the per-day `date,requests,tokens,costUsd`
 * series that feeds the analytics charts, and — when the summary carries a
 * per-project breakdown — a final `projectId,projectName,...` block.
 */
export function usageExportCsv(usage: UsageSummary): string {
  const summaryRows = [
    ["metric", "value"],
    ["periodStart", usage.periodStart],
    ["periodEnd", usage.periodEnd],
    ["requests", usage.requests],
    ["tokens", usage.tokens],
    ["costUsd", usage.costUsd],
  ]
  const dailyRows = [
    ["date", "requests", "tokens", "costUsd"],
    ...usage.daily.map((point) => [point.date, point.requests, point.tokens, point.costUsd]),
  ]
  const blocks = [summaryRows, dailyRows]
  const projects = usage.projects ?? []
  if (projects.length > 0) {
    blocks.push([
      ["projectId", "projectName", "requests", "tokens", "costUsd"],
      ...projects.map((project) => [
        project.projectId,
        project.projectName,
        project.requests,
        project.tokens,
        project.costUsd,
      ]),
    ])
  }
  return blocks
    .map((block) => block.map((row) => row.map(csvCell).join(",")).join("\n"))
    .join("\n\n")
}

/** Same usage data as JSON: period totals, the daily series, and projects. */
export function usageExportJson(usage: UsageSummary): string {
  return JSON.stringify(
    {
      periodStart: usage.periodStart,
      periodEnd: usage.periodEnd,
      totals: {
        requests: usage.requests,
        tokens: usage.tokens,
        costUsd: usage.costUsd,
      },
      daily: usage.daily,
      projects: usage.projects ?? [],
    },
    null,
    2,
  )
}

function downloadUsageExport(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

function exportUsageCsv(usage: UsageSummary) {
  downloadUsageExport("spindle-usage.csv", usageExportCsv(usage), "text/csv;charset=utf-8")
}

function exportUsageJson(usage: UsageSummary) {
  downloadUsageExport("spindle-usage.json", usageExportJson(usage), "application/json")
}

export function UsageScreen() {
  const usageQuery = useUsageSummary()
  const usageData = usageQuery.data
  const estimatedInvoice = estimatedInvoiceUsd(usageData)
  const nextInvoice = INVOICES.find((invoice) => invoice.status === "Upcoming")

  return (
    <div className="app-page">
      <div className="app-page-head">
        <div>
          <h1>Usage &amp; plan</h1>
          <p className="app-page-subtitle">
            Totals, daily charts, and the billing period come from the usage API. Plan, seat,
            storage, agent-run, and invoice figures are mock fixtures until the billing API lands.
          </p>
        </div>
        <div className="app-page-actions">
          <Button
            type="button"
            variant="outline"
            disabled={usageData === undefined}
            onClick={() => {
              if (usageData) exportUsageCsv(usageData)
            }}
          >
            <Download aria-hidden="true" />
            Export usage CSV
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={usageData === undefined}
            onClick={() => {
              if (usageData) exportUsageJson(usageData)
            }}
          >
            <Download aria-hidden="true" />
            Export usage JSON
          </Button>
          <Button asChild variant="outline">
            <Link href="/pricing">
              Compare plans
              <ArrowUpRight aria-hidden="true" />
            </Link>
          </Button>
        </div>
      </div>

      <div className="app-usage-grid">
        <section className="app-panel" aria-labelledby="current-plan-heading">
          <div className="app-panel-head">
            <div>
              <h2 id="current-plan-heading">Current plan</h2>
              <p>What this workspace is on today.</p>
            </div>
          </div>
          <div className="app-plan-summary">
            <div className="app-plan-name-row">
              <strong className="app-plan-name">{PLAN.name}</strong>
              <span
                className={`app-usage-status is-${PLAN.status === "Active" ? "ok" : "warning"}`}
              >
                {PLAN.status}
              </span>
            </div>
            <p className="app-plan-price">
              {`$${PLAN.pricePerSeatUsd}`}
              <span>{PLAN.pricePeriod}</span>
            </p>
            <dl className="app-storage-breakdown">
              <div>
                <dt>Renews</dt>
                <dd>{PLAN.renewsLabel}</dd>
              </div>
              <div>
                <dt>Seats</dt>
                <dd>
                  {PLAN.seatsUsed} of {PLAN.seatsTotal} used
                </dd>
              </div>
              <div>
                <dt>Billing period</dt>
                <dd>
                  {usageData
                    ? `${formatDate(usageData.periodStart)} – ${formatDate(usageData.periodEnd)}`
                    : "—"}
                </dd>
              </div>
              <div>
                <dt>Usage charges</dt>
                <dd>{usageData ? formatUsd(usageData.costUsd) : "—"}</dd>
              </div>
              <div>
                <dt>Next invoice</dt>
                <dd>
                  {nextInvoice ? `${nextInvoice.date} · ${formatUsd(nextInvoice.amountUsd)}` : "—"}
                </dd>
              </div>
              <div>
                <dt>Est. incl. usage</dt>
                <dd>{estimatedInvoice === undefined ? "—" : formatUsd(estimatedInvoice)}</dd>
              </div>
            </dl>
            <p className="app-field-hint">
              Seat price and invoice rows are mock fixtures; the estimated total adds metered usage
              to the seat subtotal. Real billing figures arrive with the billing API.
            </p>
            <Button asChild>
              <Link href="/pricing">Upgrade plan</Link>
            </Button>
          </div>
        </section>

        <section className="app-panel" aria-labelledby="usage-meters-heading">
          <div className="app-panel-head">
            <div>
              <h2 id="usage-meters-heading">Usage this period</h2>
              <p>
                Requests, tokens, and cost are live; storage, seats, and agent-run caps below are
                placeholders.
              </p>
            </div>
          </div>
          <QueryState<UsageSummary>
            status={usageQuery.status === "idle" ? "loading" : usageQuery.status}
            data={usageQuery.data}
            error={usageQuery.error}
            isEmpty={usageQuery.mode === "empty"}
            isRetrying={usageQuery.isRetrying}
            onRetry={usageQuery.refetch}
            loading={<LoadingPanel label="Loading usage" variant="lines" lines={2} />}
            emptyTitle="No usage this period"
            emptyBody="There is no usage recorded for the current billing period yet."
            errorTitle="Usage did not load"
            errorMessage="We could not load your usage totals. Try again to refresh requests, tokens, and cost."
          >
            {(usage) => <UsageTotals usage={usage} />}
          </QueryState>
          <div className="app-usage-meters">
            {USAGE_METERS.map((meter) => {
              const status = meterStatus(meter.percent)
              return (
                <div className="app-usage-meter" key={meter.id}>
                  <div className="app-usage-meter-head">
                    <span className="app-usage-meter-label">{meter.label}</span>
                    <span className={`app-usage-status is-${status}`}>
                      {METER_STATUS_LABEL[status]}
                    </span>
                  </div>
                  <div className="app-usage-meter-values">
                    <strong>
                      {meter.usedLabel}
                      <span> / {meter.limitLabel}</span>
                    </strong>
                    <span>{Math.round(meter.percent)}%</span>
                  </div>
                  <Progress
                    value={Math.min(100, meter.percent)}
                    aria-label={`${meter.label} usage`}
                  />
                  <p className="app-usage-meter-detail">{meter.detail}</p>
                </div>
              )
            })}
          </div>
        </section>

        <UsageAlertsPanel usage={usageData} />
      </div>

      <QueryState<UsageSummary>
        status={usageQuery.status === "idle" ? "loading" : usageQuery.status}
        data={usageQuery.data}
        error={usageQuery.error}
        isEmpty={usageQuery.mode === "empty"}
        isRetrying={usageQuery.isRetrying}
        onRetry={usageQuery.refetch}
        loading={<LoadingPanel label="Loading usage charts" variant="lines" lines={2} />}
        emptyTitle="No daily usage yet"
        emptyBody="There is no per-day usage recorded for the current billing period."
        errorTitle="Usage charts did not load"
        errorMessage="We could not load the daily usage breakdown. Try again to refresh the charts."
      >
        {(usage) => <UsageAnalytics usage={usage} />}
      </QueryState>

      {usageData ? <UsageForecastSection usage={usageData} /> : null}

      {usageData ? <UsageComparisonSection usage={usageData} /> : null}

      {usageData ? <UsageByProject usage={usageData} /> : null}

      <div className="app-dashboard-columns">
        <section className="app-panel" aria-labelledby="whats-included-heading">
          <div className="app-panel-head">
            <div>
              <h2 id="whats-included-heading">What&apos;s included</h2>
              <p>How the plans compare — your current plan is highlighted.</p>
            </div>
          </div>
          <div className="app-table-wrap">
            <table className="app-data-table">
              <thead>
                <tr>
                  <th scope="col">Feature</th>
                  <th scope="col">Hobby</th>
                  <th scope="col" className="is-current">
                    Team
                  </th>
                  <th scope="col">Enterprise</th>
                </tr>
              </thead>
              <tbody>
                {PLAN_FEATURES.map((row) => (
                  <tr key={row.feature}>
                    <th scope="row">{row.feature}</th>
                    <FeatureCell value={row.hobby} />
                    <FeatureCell value={row.team} current />
                    <FeatureCell value={row.enterprise} />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="app-panel" aria-labelledby="billing-heading">
          <div className="app-panel-head">
            <div>
              <h2 id="billing-heading">Billing history</h2>
              <p>
                Mock invoices tied to billing periods — the row matching the current usage period is
                highlighted. The billing API does not exist yet.
              </p>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={exportInvoicesCsv}>
              <Download aria-hidden="true" />
              Export CSV
            </Button>
          </div>
          <div className="app-table-wrap">
            <table className="app-data-table">
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">Period</th>
                  <th scope="col">Description</th>
                  <th scope="col">Amount</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {INVOICES.map((invoice) => {
                  const isCurrent = coversUsagePeriod(invoice, usageData)
                  const cellClass = isCurrent ? "is-current" : undefined
                  return (
                    <tr key={invoice.id}>
                      <td className={cellClass}>{invoice.date}</td>
                      <td className={cellClass}>
                        {formatDate(invoice.periodStart)} – {formatDate(invoice.periodEnd)}
                      </td>
                      <td className={cellClass}>{invoice.description}</td>
                      <td className={cellClass}>{formatUsd(invoice.amountUsd)}</td>
                      <td className={cellClass}>
                        {isCurrent ? (
                          <span className="app-usage-status is-ok">This period</span>
                        ) : null}{" "}
                        <span
                          className={`app-usage-status is-${invoice.status === "Paid" ? "ok" : "warning"}`}
                        >
                          {invoice.status}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  )
}
