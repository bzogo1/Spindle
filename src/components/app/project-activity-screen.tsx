"use client"

import Link from "next/link"
import { Activity } from "lucide-react"

import { ActivityFeed } from "@/components/app/activity-feed"
import { ScreenState } from "@/components/app/states/screen-state"
import { EmptyState } from "@/components/app/states/empty-state"
import { useProjectHome } from "@/lib/api"

import { formatDateTime } from "./format"

export function ProjectActivityScreen({ projectId }: { projectId: string }) {
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
      {(data) => (
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
                  {data.activity.length} event{data.activity.length === 1 ? "" : "s"}
                </p>
              </div>
            </div>
            {data.activity.length === 0 ? (
              <EmptyState
                icon={<Activity aria-hidden="true" />}
                title="No recent activity"
                body="Project events will appear here as files, sessions, messages, and runs change."
                primaryAction={{ label: "Open files", href: `/projects/${projectId}/files` }}
              />
            ) : (
              <ActivityFeed events={data.activity} projectId={projectId} />
            )}
          </section>

          <p className="app-generated-at">Data generated {formatDateTime(data.generatedAt)}</p>
        </div>
      )}
    </ScreenState>
  )
}
