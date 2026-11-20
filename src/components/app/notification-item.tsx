"use client"

import Link from "next/link"
import { useState } from "react"
import { Check, CircleAlert, CircleCheck, Clock, Info, TriangleAlert, Undo2, X } from "lucide-react"
import { Popover as PopoverPrimitive } from "radix-ui"

import {
  SNOOZE_PRESETS,
  snoozeUntilFor,
  type NotificationAction,
} from "@/lib/notifications/actions"
import { formatRelativeTime } from "./format"
import { NotificationMarkdown } from "./notification-markdown"
import type { AppNotification } from "./notifications-provider"

const NOTIFICATION_ICONS = {
  info: Info,
  success: CircleCheck,
  warning: TriangleAlert,
  error: CircleAlert,
} as const

/** Controls the inbox wires in; every prop is optional so the item still renders standalone. */
export interface NotificationItemControls {
  /** Flip read state (read → unread, unread → read). */
  onToggleRead?: (id: string) => void
  /** Snooze until the given ISO instant. */
  onSnooze?: (id: string, untilIso: string) => void
  /** Remove the notification from the feed. */
  onDismiss?: (id: string) => void
  /** Execute a producer-declared action from `notification.actions`. */
  onAction?: (notification: AppNotification, action: NotificationAction) => void
}

const ACTION_BUTTON_CLASS =
  "text-muted-foreground hover:text-foreground inline-flex size-6 items-center justify-center rounded-md transition-colors hover:bg-[var(--app-panel-alt)]"

function NotificationActionButtons({
  notification,
  controls,
}: {
  notification: AppNotification
  controls: NotificationItemControls
}) {
  const { onToggleRead, onSnooze, onDismiss, onAction } = controls
  const [snoozeOpen, setSnoozeOpen] = useState(false)

  // Custom actions only render when a handler is wired — a producer-declared
  // action without `onAction` would be a dead button.
  const customActions = onAction ? (notification.actions ?? []) : []
  const hasControls = Boolean(onToggleRead || onSnooze || onDismiss || customActions.length > 0)
  if (!hasControls) return null

  return (
    <div
      className="flex flex-none items-center gap-0.5 pt-1"
      onClick={(event) => event.stopPropagation()}
    >
      {customActions.map((action) =>
        action.href ? (
          <Link
            key={action.id}
            href={action.href}
            className={`${ACTION_BUTTON_CLASS} px-1.5 text-[11px] font-medium`}
            onClick={() => onAction?.(notification, action)}
          >
            {action.label}
          </Link>
        ) : (
          <button
            key={action.id}
            type="button"
            className={`${ACTION_BUTTON_CLASS} px-1.5 text-[11px] font-medium`}
            onClick={() => onAction?.(notification, action)}
          >
            {action.label}
          </button>
        ),
      )}
      {onSnooze ? (
        <PopoverPrimitive.Root open={snoozeOpen} onOpenChange={setSnoozeOpen}>
          <PopoverPrimitive.Trigger asChild>
            <button
              type="button"
              className={ACTION_BUTTON_CLASS}
              aria-label="Snooze notification"
              title="Snooze"
            >
              <Clock aria-hidden="true" className="size-3.5" />
            </button>
          </PopoverPrimitive.Trigger>
          <PopoverPrimitive.Portal>
            <PopoverPrimitive.Content
              className="app-notifications-popover"
              align="end"
              sideOffset={6}
              aria-label="Snooze notification"
            >
              <ul className="app-notifications-list">
                {SNOOZE_PRESETS.map((preset) => (
                  <li key={preset.id}>
                    <button
                      type="button"
                      className="app-notification-item"
                      onClick={() => {
                        const until = snoozeUntilFor(preset.id)
                        if (until) onSnooze(notification.id, until)
                        setSnoozeOpen(false)
                      }}
                    >
                      <span className="app-notification-main">
                        <span className="app-notification-title-row">
                          <strong>{preset.label}</strong>
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </PopoverPrimitive.Content>
          </PopoverPrimitive.Portal>
        </PopoverPrimitive.Root>
      ) : null}
      {onToggleRead ? (
        <button
          type="button"
          className={ACTION_BUTTON_CLASS}
          aria-label={notification.read ? "Mark as unread" : "Mark as read"}
          title={notification.read ? "Mark as unread" : "Mark as read"}
          onClick={() => onToggleRead(notification.id)}
        >
          {notification.read ? (
            <Undo2 aria-hidden="true" className="size-3.5" />
          ) : (
            <Check aria-hidden="true" className="size-3.5" />
          )}
        </button>
      ) : null}
      {onDismiss ? (
        <button
          type="button"
          className={ACTION_BUTTON_CLASS}
          aria-label="Dismiss notification"
          title="Dismiss"
          onClick={() => onDismiss(notification.id)}
        >
          <X aria-hidden="true" className="size-3.5" />
        </button>
      ) : null}
    </div>
  )
}

export function NotificationItem({
  notification,
  onRead,
  onToggleRead,
  onSnooze,
  onDismiss,
  onAction,
}: {
  notification: AppNotification
  onRead: (id: string) => void
} & NotificationItemControls) {
  const Icon = NOTIFICATION_ICONS[notification.type]
  const className = `app-notification-item min-w-0 flex-1${notification.read ? "" : " is-unread"}`
  const controls: NotificationItemControls = { onToggleRead, onSnooze, onDismiss, onAction }
  const content = (
    <>
      <span className={`app-notification-icon is-${notification.type}`} aria-hidden="true">
        <Icon />
      </span>
      <div className="app-notification-main">
        <span className="app-notification-title-row">
          {!notification.read ? <span className="sr-only">Unread: </span> : null}
          <strong>{notification.title}</strong>
          {notification.demo ? <span className="text-muted-foreground text-xs">(demo)</span> : null}
          {!notification.read ? (
            <span className="app-notification-unread-dot" aria-hidden="true" />
          ) : null}
        </span>
        <div className="app-notification-body">
          <NotificationMarkdown>{notification.body}</NotificationMarkdown>
        </div>
        <span className="app-notification-time">{formatRelativeTime(notification.createdAt)}</span>
      </div>
    </>
  )

  const row = notification.href ? (
    <Link href={notification.href} className={className} onClick={() => onRead(notification.id)}>
      {content}
    </Link>
  ) : (
    <button type="button" className={className} onClick={() => onRead(notification.id)}>
      {content}
    </button>
  )

  return (
    <div className="flex min-w-0 items-start gap-1">
      {row}
      <NotificationActionButtons notification={notification} controls={controls} />
    </div>
  )
}
