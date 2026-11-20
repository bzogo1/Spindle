"use client"

import { useState, type ReactNode } from "react"
import { ChevronDown, ChevronRight, MessagesSquare } from "lucide-react"

import type { NotificationThread } from "@/lib/notifications/threads"
import { formatRelativeTime } from "./format"
import type { AppNotification } from "./notifications-provider"

/**
 * A collapsed-by-default thread row: the newest notification renders in full
 * (via `renderItem`), a digest line summarizes the burst ("5 updates · 2
 * unread · latest 12m ago"), and expanding reveals the earlier members.
 */
export function NotificationThreadView({
  thread,
  renderItem,
}: {
  thread: NotificationThread<AppNotification>
  renderItem: (notification: AppNotification) => ReactNode
}) {
  const [expanded, setExpanded] = useState(false)
  const [latest, ...earlier] = thread.items

  const summary = [
    `${thread.items.length} ${thread.items.length === 1 ? "update" : "updates"}`,
    thread.unreadCount > 0 ? `${thread.unreadCount} unread` : null,
    `latest ${formatRelativeTime(thread.latestAt)}`,
  ]
    .filter(Boolean)
    .join(" · ")

  return (
    <li className="app-notification-thread grid gap-1">
      {latest ? renderItem(latest) : null}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 pb-1">
        <span className="text-muted-foreground inline-flex items-center gap-1.5 text-xs">
          <MessagesSquare aria-hidden="true" className="size-3.5" />
          {summary}
        </span>
        {earlier.length > 0 ? (
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs font-medium"
            aria-expanded={expanded}
            onClick={() => setExpanded((current) => !current)}
          >
            {expanded ? (
              <>
                <ChevronDown aria-hidden="true" className="size-3.5" />
                Show less
              </>
            ) : (
              <>
                <ChevronRight aria-hidden="true" className="size-3.5" />
                Show {earlier.length} earlier {earlier.length === 1 ? "update" : "updates"}
              </>
            )}
          </button>
        ) : null}
      </div>
      {expanded && earlier.length > 0 ? (
        <ul className="app-notification-category-list">
          {earlier.map((notification) => (
            <li key={notification.id}>{renderItem(notification)}</li>
          ))}
        </ul>
      ) : null}
    </li>
  )
}
