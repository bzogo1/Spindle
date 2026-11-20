"use client"

import Link from "next/link"
import { useState } from "react"
import { Activity, Download, Search } from "lucide-react"

import { ActivityFeed } from "@/components/app/activity-feed"
import { ScreenState } from "@/components/app/states/screen-state"
import { EmptyState } from "@/components/app/states/empty-state"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useProjectHome } from "@/lib/api"
import type { ActivityEvent, ActivityKind } from "@/lib/api/types"
import { mergeActivityEvents } from "@/lib/activity/client"
import { ACTIVITY_KINDS } from "@/lib/activity/events"
import { useActivityEvents } from "@/lib/activity/use-activity-events"

import { formatDateTime } from "./format"

/** Client-side page size for the project activity feed (the API returns all events at once). */
const ACTIVITY_PAGE_SIZE = 10

type KindFilter = ActivityKind | "all"

const KIND_FILTER_OPTIONS: { value: KindFilter; label: string }[] = [
  { value: "all", label: "All types" },
  ...ACTIVITY_KINDS.map((kind) => ({
    value: kind,
    label: kind.charAt(0).toUpperCase() + kind.slice(1),
  })),
]

function csvCell(cell: string) {
  return `"${cell.replaceAll('"', '""')}"`
}

/**
 * Activity export payload as CSV: one row per event with
 * `timestamp,kind,actor,summary,target` columns, in feed order (newest first).
 */
export function activityExportCsv(events: ActivityEvent[]): string {
  const rows = [
    ["timestamp", "kind", "actor", "summary", "target"],
    ...events.map((event) => [
      event.createdAt,
      event.kind,
      event.actor.name,
      event.summary,
      event.target ?? "",
    ]),
  ]
  return rows.map((row) => row.map(csvCell).join(",")).join("\n")
}

/** Same activity data as JSON: one object per event with the exported fields. */
export function activityExportJson(events: ActivityEvent[]): string {
  return JSON.stringify(
    events.map((event) => ({
      timestamp: event.createdAt,
      kind: event.kind,
      actor: event.actor.name,
      summary: event.summary,
      target: event.target ?? null,
    })),
    null,
    2,
  )
}

/** Case-insensitive substring match over the event's actor, summary, and target text. */
function activityMatchesSearch(event: ActivityEvent, term: string) {
  return (
    event.summary.toLowerCase().includes(term) ||
    event.actor.name.toLowerCase().includes(term) ||
    (event.target?.toLowerCase().includes(term) ?? false)
  )
}

function downloadActivityExport(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

function exportActivityCsv(projectId: string, events: ActivityEvent[]) {
  downloadActivityExport(
    `spindle-activity-${projectId}.csv`,
    activityExportCsv(events),
    "text/csv;charset=utf-8",
  )
}

function exportActivityJson(projectId: string, events: ActivityEvent[]) {
  downloadActivityExport(
    `spindle-activity-${projectId}.json`,
    activityExportJson(events),
    "application/json",
  )
}

export function ProjectActivityScreen({ projectId }: { projectId: string }) {
  const query = useProjectHome(projectId)
  // Live events arrive over CustomEvent/BroadcastChannel/SSE and merge with
  // the fetched feed by id, so new activity appears without a refetch.
  const liveActivity = useActivityEvents(projectId)
  const [kindFilter, setKindFilter] = useState<KindFilter>("all")
  const [searchQuery, setSearchQuery] = useState("")
  const searchTerm = searchQuery.trim().toLowerCase()

  return (
    <ScreenState
      screen="project"
      status={query.status}
      data={query.data}
      error={query.error}
      isRetrying={query.isRetrying}
      onRetry={query.refetch}
    >
      {(data) => {
        const activity = mergeActivityEvents(data.activity, liveActivity)
        const kindFilteredActivity =
          kindFilter === "all" ? activity : activity.filter((event) => event.kind === kindFilter)
        const filteredActivity = searchTerm
          ? kindFilteredActivity.filter((event) => activityMatchesSearch(event, searchTerm))
          : kindFilteredActivity
        return (
          <div className="app-page">
            <header className="app-project-header app-project-header--compact">
              <nav className="app-breadcrumb" aria-label="Breadcrumb">
                <Link href="/dashboard">Dashboard</Link>
                <span aria-hidden="true">/</span>
                <Link href={`/projects/${projectId}`}>{data.project.name}</Link>
                <span aria-hidden="true">/</span>
                <span>Activity</span>
              </nav>
              <h1>Activity</h1>
              <p className="app-page-lede">
                Everything that happened in {data.project.name}, newest first.
              </p>
            </header>

            <section className="app-panel" aria-labelledby="all-activity-heading">
              <div className="app-panel-head">
                <div>
                  <h2 id="all-activity-heading">All activity</h2>
                  <p>
                    {searchTerm ? (
                      <>
                        {filteredActivity.length} of {kindFilteredActivity.length}{" "}
                        {kindFilteredActivity.length === 1 ? "event" : "events"} match &ldquo;
                        {searchQuery.trim()}&rdquo;
                      </>
                    ) : (
                      <>
                        {filteredActivity.length} event{filteredActivity.length === 1 ? "" : "s"}
                        {kindFilter !== "all" ? ` of ${activity.length}` : ""}
                      </>
                    )}
                  </p>
                </div>
                <div className="app-toolbar">
                  <label className="app-search-field">
                    <Search aria-hidden="true" />
                    <span className="sr-only">Search activity</span>
                    <Input
                      type="search"
                      value={searchQuery}
                      onChange={(event) => setSearchQuery(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") setSearchQuery("")
                      }}
                      placeholder="Search activity"
                      aria-label="Search activity"
                    />
                  </label>
                  <label className="app-sort-field">
                    <span className="sr-only">Filter by type</span>
                    <select
                      value={kindFilter}
                      onChange={(event) => setKindFilter(event.target.value as KindFilter)}
                      aria-label="Filter by type"
                    >
                      {KIND_FILTER_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={filteredActivity.length === 0}
                    onClick={() => exportActivityCsv(projectId, filteredActivity)}
                  >
                    <Download aria-hidden="true" />
                    Export CSV
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={filteredActivity.length === 0}
                    onClick={() => exportActivityJson(projectId, filteredActivity)}
                  >
                    <Download aria-hidden="true" />
                    Export JSON
                  </Button>
                </div>
              </div>
              {activity.length === 0 ? (
                <EmptyState
                  icon={<Activity aria-hidden="true" />}
                  title="No recent activity"
                  body="Project events will appear here as files, sessions, messages, and runs change."
                  primaryAction={{ label: "Open files", href: `/projects/${projectId}/files` }}
                />
              ) : filteredActivity.length === 0 ? (
                <EmptyState
                  icon={<Activity aria-hidden="true" />}
                  title={searchTerm ? "No matching activity" : `No ${kindFilter} activity`}
                  body={
                    searchTerm
                      ? `No events match "${searchQuery.trim()}".`
                      : "No events of this type have been recorded for the project yet."
                  }
                  primaryAction={{
                    label: "Show all activity",
                    variant: "outline",
                    onClick: () => {
                      setKindFilter("all")
                      setSearchQuery("")
                    },
                  }}
                />
              ) : (
                <ActivityFeed
                  key={`${kindFilter}:${searchTerm}`}
                  events={filteredActivity}
                  projectId={projectId}
                  groupByDay
                  pageSize={ACTIVITY_PAGE_SIZE}
                  term={searchTerm || undefined}
                />
              )}
            </section>

            <p className="app-generated-at">Data generated {formatDateTime(data.generatedAt)}</p>
          </div>
        )
      }}
    </ScreenState>
  )
}
