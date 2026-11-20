"use client"

import Link from "next/link"
import { useMemo, type CSSProperties } from "react"
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import { Activity, Bot, Files, FlaskConical, HardDrive, MessageSquare } from "lucide-react"

import { ScreenState } from "@/components/app/states/screen-state"
import { EmptyState } from "@/components/app/states/empty-state"
import { useProjectHome } from "@/lib/api"
import type { ActivityEvent, ActivityKind, ProjectHomeData } from "@/lib/api/types"
import { mergeActivityEvents } from "@/lib/activity/client"
import { ACTIVITY_KINDS } from "@/lib/activity/events"
import { useActivityEvents } from "@/lib/activity/use-activity-events"

import { formatBytes, formatDateTime } from "./format"

/** Days of activity history shown in the daily chart. */
const ACTIVITY_WINDOW_DAYS = 14

const CHART_AXIS_TICK = { fontSize: 11, fill: "var(--app-text-muted)" } as const

const CHART_TOOLTIP_STYLE: CSSProperties = {
  background: "var(--app-panel)",
  border: "1px solid var(--app-border)",
  borderRadius: 8,
  color: "var(--app-text)",
  fontSize: 12,
}

export interface ActivityByKindEntry {
  kind: ActivityKind
  label: string
  count: number
}

export interface DailyActivityPoint {
  date: string
  events: number
}

function dayKey(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

function formatDayTick(value: string) {
  const date = new Date(`${value}T00:00:00`)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

function kindLabel(kind: ActivityKind) {
  return kind.charAt(0).toUpperCase() + kind.slice(1)
}

/** Counts events per activity kind, ordered by `ACTIVITY_KINDS` (kinds with zero events are kept). */
export function activityByKind(events: ActivityEvent[]): ActivityByKindEntry[] {
  const counts = new Map<ActivityKind, number>()
  for (const kind of ACTIVITY_KINDS) counts.set(kind, 0)
  for (const event of events) {
    counts.set(event.kind, (counts.get(event.kind) ?? 0) + 1)
  }
  return ACTIVITY_KINDS.map((kind) => ({
    kind,
    label: kindLabel(kind),
    count: counts.get(kind) ?? 0,
  }))
}

/**
 * Buckets events into the last `days` calendar days (local time), oldest first,
 * so the chart always renders a full window even when recent days are empty.
 */
export function dailyActivitySeries(
  events: ActivityEvent[],
  days = ACTIVITY_WINDOW_DAYS,
): DailyActivityPoint[] {
  const counts = new Map<string, number>()
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const day = new Date(today)
    day.setDate(day.getDate() - offset)
    counts.set(dayKey(day), 0)
  }
  for (const event of events) {
    const time = new Date(event.createdAt).getTime()
    if (Number.isNaN(time)) continue
    const key = dayKey(new Date(time))
    if (counts.has(key)) counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return [...counts.entries()].map(([date, count]) => ({ date, events: count }))
}

function StatCard({
  icon,
  label,
  value,
  detail,
}: {
  icon: React.ReactNode
  label: string
  value: string
  detail?: string
}) {
  return (
    <article className="app-stat-card">
      <span className="app-stat-card-label">
        {icon}
        {label}
      </span>
      <strong>{value}</strong>
      {detail ? <small>{detail}</small> : null}
    </article>
  )
}

function ActivityCharts({ activity }: { activity: ActivityEvent[] }) {
  const byKind = useMemo(() => activityByKind(activity), [activity])
  const daily = useMemo(() => dailyActivitySeries(activity), [activity])

  return (
    <div className="app-usage-grid">
      <section className="app-panel" aria-labelledby="activity-by-kind-heading">
        <div className="app-panel-head">
          <div>
            <h2 id="activity-by-kind-heading">Activity by type</h2>
            <p>Events recorded for this project, grouped by kind.</p>
          </div>
        </div>
        <div className="app-usage-chart-plot">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={byKind}
              layout="vertical"
              margin={{ top: 8, right: 16, bottom: 0, left: 8 }}
            >
              <CartesianGrid stroke="var(--app-border)" horizontal={false} />
              <XAxis
                type="number"
                tick={CHART_AXIS_TICK}
                tickLine={false}
                axisLine={false}
                allowDecimals={false}
              />
              <YAxis
                type="category"
                dataKey="label"
                tick={CHART_AXIS_TICK}
                tickLine={false}
                axisLine={false}
                width={64}
              />
              <Tooltip
                formatter={(value) => (value == null ? "" : Number(value).toLocaleString())}
                contentStyle={CHART_TOOLTIP_STYLE}
              />
              <Bar dataKey="count" name="Events" fill="var(--app-accent)" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="app-panel" aria-labelledby="daily-activity-heading">
        <div className="app-panel-head">
          <div>
            <h2 id="daily-activity-heading">Daily activity</h2>
            <p>Events per day over the last {ACTIVITY_WINDOW_DAYS} days.</p>
          </div>
        </div>
        <div className="app-usage-chart-plot">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={daily} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
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
      </section>
    </div>
  )
}

function ProjectAnalyticsLoaded({ data, projectId }: { data: ProjectHomeData; projectId: string }) {
  // Live activity events merge with the fetched feed by id so the counts and
  // charts reflect events that arrive after the initial load.
  const liveActivity = useActivityEvents(projectId)
  const activity = mergeActivityEvents(data.activity, liveActivity)
  const succeededRuns = data.agentRuns.filter((run) => run.status === "succeeded").length
  const runningSessions = data.labSessions.filter(
    (session) => session.status === "running" || session.status === "queued",
  ).length

  return (
    <div className="app-page">
      <header className="app-project-header app-project-header--compact">
        <nav className="app-breadcrumb" aria-label="Breadcrumb">
          <Link href="/dashboard">Dashboard</Link>
          <span aria-hidden="true">/</span>
          <Link href={`/projects/${projectId}`}>{data.project.name}</Link>
          <span aria-hidden="true">/</span>
          <span>Analytics</span>
        </nav>
        <h1>Analytics</h1>
        <p className="app-page-lede">Usage totals and activity trends for {data.project.name}.</p>
      </header>

      <section className="app-stat-grid" aria-label="Project totals">
        <StatCard
          icon={<Files aria-hidden="true" />}
          label="Files"
          value={data.files.length.toLocaleString()}
          detail="project files"
        />
        <StatCard
          icon={<FlaskConical aria-hidden="true" />}
          label="Lab sessions"
          value={data.labSessions.length.toLocaleString()}
          detail={`${runningSessions} active`}
        />
        <StatCard
          icon={<Bot aria-hidden="true" />}
          label="Agent runs"
          value={data.agentRuns.length.toLocaleString()}
          detail={`${succeededRuns} succeeded`}
        />
        <StatCard
          icon={<MessageSquare aria-hidden="true" />}
          label="Chat messages"
          value={data.chatMessages.length.toLocaleString()}
          detail="in project chat"
        />
        <StatCard
          icon={<Activity aria-hidden="true" />}
          label="Activity events"
          value={activity.length.toLocaleString()}
          detail="all time"
        />
        <StatCard
          icon={<HardDrive aria-hidden="true" />}
          label="Storage"
          value={formatBytes(data.storageBytes)}
          detail="project files"
        />
      </section>

      {activity.length === 0 ? (
        <section className="app-panel" aria-labelledby="activity-charts-heading">
          <div className="app-panel-head">
            <div>
              <h2 id="activity-charts-heading">Activity</h2>
              <p>Event trends will appear here as the project changes.</p>
            </div>
          </div>
          <EmptyState
            icon={<Activity aria-hidden="true" />}
            title="No activity yet"
            body="Upload a file, start a lab session, or message the agent to see analytics here."
            primaryAction={{ label: "Open files", href: `/projects/${projectId}/files` }}
          />
        </section>
      ) : (
        <ActivityCharts activity={activity} />
      )}

      <p className="app-generated-at">Data generated {formatDateTime(data.generatedAt)}</p>
    </div>
  )
}

export function ProjectAnalyticsScreen({ projectId }: { projectId: string }) {
  const query = useProjectHome(projectId)

  return (
    <ScreenState
      screen="project"
      status={query.status}
      data={query.data}
      error={query.error}
      isRetrying={query.isRetrying}
      onRetry={query.refetch}
    >
      {(data) => <ProjectAnalyticsLoaded data={data} projectId={projectId} />}
    </ScreenState>
  )
}
