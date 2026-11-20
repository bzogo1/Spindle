"use client"

import { History } from "lucide-react"

import { useSettingsAuditLog, toActivityEvent } from "@/lib/settings-audit"

import { ActivityFeed } from "./activity-feed"
import { EmptyState } from "./states/empty-state"

/**
 * Settings change audit log for one scope ("workspace" or
 * `project:<projectId>`). Renders through the shared activity feed so audit
 * entries look and group like the rest of the app's activity.
 */
export function SettingsAuditLog({
  scope,
  projectId,
  projectName,
  emptyTitle = "No settings changes yet",
  emptyBody = "Changes you save in these settings will be listed here, newest first.",
}: {
  scope: string
  /** Passed through to the feed so project entries link back to the project. */
  projectId?: string
  projectName?: string
  emptyTitle?: string
  emptyBody?: string
}) {
  const entries = useSettingsAuditLog(scope)

  if (entries.length === 0) {
    return <EmptyState icon={<History aria-hidden="true" />} title={emptyTitle} body={emptyBody} />
  }

  return (
    <ActivityFeed
      events={entries.map((entry) => {
        const event = toActivityEvent(entry)
        return projectName ? { ...event, projectName } : event
      })}
      projectId={projectId}
      groupByDay
      pageSize={10}
    />
  )
}
