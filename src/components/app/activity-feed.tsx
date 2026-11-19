"use client"

import Link from "next/link"

import type { ActivityEvent } from "@/lib/api/types"

import { formatRelativeTime } from "./format"

export function ActivityFeed({
  events,
  projectId,
}: {
  events: ActivityEvent[]
  projectId?: string
}) {
  if (events.length === 0) return null

  return (
    <ol className="app-activity-list">
      {events.map((event) => {
        const targetProjectId = event.projectId ?? projectId
        return (
          <li key={event.id}>
            <span className={`app-activity-kind is-${event.kind}`}>{event.kind}</span>
            <div>
              <p>
                <strong>{event.actor.name}</strong> {event.summary}
                {event.target ? ` ${event.target}` : ""}
              </p>
              <small>
                {targetProjectId ? (
                  <Link href={`/projects/${targetProjectId}`}>
                    {event.projectName ?? "Project"}
                  </Link>
                ) : (
                  (event.projectName ?? "Workspace")
                )}
                {" · "}
                {formatRelativeTime(event.createdAt)}
              </small>
            </div>
          </li>
        )
      })}
    </ol>
  )
}
