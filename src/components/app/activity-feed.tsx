"use client"

import Link from "next/link"
import { useState } from "react"
import {
  Activity,
  Bot,
  Files,
  FlaskConical,
  FolderKanban,
  MessageSquare,
  Settings,
  type LucideIcon,
} from "lucide-react"

import { getAvatarInitials } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import type { ActivityEvent, ActivityKind } from "@/lib/api/types"

import { formatDateTime, formatRelativeTime } from "./format"

const KIND_ICONS: Record<ActivityKind, LucideIcon> = {
  project: FolderKanban,
  file: Files,
  lab: FlaskConical,
  chat: MessageSquare,
  agent: Bot,
  system: Settings,
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/** Wrap case-insensitive occurrences of `term` in <mark> for search hits. */
function HighlightedActivityText({ text, term }: { text: string; term?: string }) {
  const needle = term?.trim()
  if (!needle) return <>{text}</>
  const pattern = new RegExp(`(${escapeRegExp(needle)})`, "gi")
  return (
    <>
      {text.split(pattern).map((part, index) =>
        index % 2 === 1 ? (
          <mark key={index} className="app-activity-mark">
            {part}
          </mark>
        ) : (
          part
        ),
      )}
    </>
  )
}

const DAY_MS = 24 * 60 * 60 * 1000

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

/** Human label for an activity day: Today / Yesterday / "Nov 18" (year when it differs). */
function formatActivityDay(value: string, now = new Date()) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value

  const dayDiff = Math.round((startOfDay(now) - startOfDay(date)) / DAY_MS)
  if (dayDiff === 0) return "Today"
  if (dayDiff === 1) return "Yesterday"

  const sameYear = date.getFullYear() === now.getFullYear()
  return date.toLocaleDateString(
    undefined,
    sameYear
      ? { month: "short", day: "numeric" }
      : { month: "short", day: "numeric", year: "numeric" },
  )
}

interface ActivityDayGroup {
  key: string
  label: string | null
  items: ActivityEvent[]
}

/** Bucket events by local calendar day, preserving the feed's newest-first order. */
function groupEventsByDay(events: ActivityEvent[], now = new Date()): ActivityDayGroup[] {
  const groups = new Map<string, ActivityDayGroup>()
  for (const event of events) {
    const date = new Date(event.createdAt)
    const key = Number.isNaN(date.getTime()) ? "unknown" : String(startOfDay(date))
    let group = groups.get(key)
    if (!group) {
      group = { key, label: formatActivityDay(event.createdAt, now), items: [] }
      groups.set(key, group)
    }
    group.items.push(event)
  }
  return [...groups.values()]
}

function ActivityFeedItem({
  event,
  projectId,
  term,
}: {
  event: ActivityEvent
  projectId?: string
  /** Lowercased, trimmed search term; matched text renders in <mark>. */
  term?: string
}) {
  const KindIcon = KIND_ICONS[event.kind] ?? Activity
  const targetProjectId = event.projectId ?? projectId

  return (
    <li>
      <span className="app-activity-avatar" aria-hidden="true">
        {getAvatarInitials(event.actor.name)}
      </span>
      <span className={`app-activity-kind is-${event.kind}`}>
        <KindIcon aria-hidden="true" />
        {event.kind}
      </span>
      <div>
        <p>
          <strong>
            <HighlightedActivityText text={event.actor.name} term={term} />
          </strong>{" "}
          <HighlightedActivityText text={event.summary} term={term} />
          {event.target ? (
            <>
              {" "}
              <span className="app-activity-target">
                <HighlightedActivityText text={event.target} term={term} />
              </span>
            </>
          ) : null}
        </p>
        <small>
          {targetProjectId ? (
            <Link href={`/projects/${targetProjectId}`}>{event.projectName ?? "Project"}</Link>
          ) : (
            (event.projectName ?? "Workspace")
          )}
          {" · "}
          <time dateTime={event.createdAt} title={formatDateTime(event.createdAt)}>
            {formatRelativeTime(event.createdAt)}
          </time>
        </small>
      </div>
    </li>
  )
}

export function ActivityFeed({
  events,
  projectId,
  groupByDay = false,
  pageSize,
  term,
}: {
  events: ActivityEvent[]
  projectId?: string
  /** Render "Today" / "Yesterday" / date headings between day buckets. */
  groupByDay?: boolean
  /** When set, only this many events render initially; a "Show more" button reveals the rest. */
  pageSize?: number
  /** Lowercased, trimmed search term used to highlight matches in actor, summary, and target. */
  term?: string
}) {
  const [visibleCount, setVisibleCount] = useState<number | null>(null)

  if (events.length === 0) return null

  const limit = pageSize === undefined ? events.length : (visibleCount ?? pageSize)
  const visibleEvents = events.slice(0, limit)
  const hiddenCount = events.length - visibleEvents.length
  const step = pageSize ?? events.length

  const groups: ActivityDayGroup[] = groupByDay
    ? groupEventsByDay(visibleEvents)
    : [{ key: "all", label: null, items: visibleEvents }]

  return (
    <div className="app-activity-feed">
      {groups.map((group) => (
        <div key={group.key} className="app-activity-day">
          {group.label ? <h3 className="app-activity-day-label">{group.label}</h3> : null}
          <ol className="app-activity-list">
            {group.items.map((event) => (
              <ActivityFeedItem key={event.id} event={event} projectId={projectId} term={term} />
            ))}
          </ol>
        </div>
      ))}
      {hiddenCount > 0 ? (
        <div className="app-activity-more">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setVisibleCount(limit + step)}
          >
            Show more
          </Button>
          <span className="app-activity-more-count">
            {visibleEvents.length} of {events.length} shown
          </span>
        </div>
      ) : null}
    </div>
  )
}
