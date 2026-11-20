"use client"

import { useState } from "react"
import Link from "next/link"
import { Bell, CheckCheck, Settings } from "lucide-react"
import { Popover as PopoverPrimitive } from "radix-ui"

import { useAppNotifications } from "./notifications-provider"
import { NotificationItem } from "./notification-item"

const DROPDOWN_LIMIT = 5

export function NotificationBell() {
  const {
    notifications,
    unreadCount,
    markRead,
    markAllRead,
    toggleRead,
    dismiss,
    snooze,
    performAction,
  } = useAppNotifications()
  const [open, setOpen] = useState(false)
  const visibleNotifications = notifications.slice(0, DROPDOWN_LIMIT)
  const badgeLabel = unreadCount > 99 ? "99+" : String(unreadCount)

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger asChild>
        <button
          type="button"
          className="app-icon-button app-notification-trigger"
          aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"}
        >
          <span className="app-notification-icon">
            <Bell aria-hidden="true" />
            {unreadCount > 0 ? (
              <span className="app-notification-badge" aria-hidden="true">
                {badgeLabel}
              </span>
            ) : null}
          </span>
        </button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          className="app-notifications-popover"
          align="end"
          sideOffset={8}
          aria-label="Notifications"
        >
          <div className="app-notifications-panel">
            <div className="app-notifications-panel-head">
              <div>
                <h2>Notifications</h2>
                <p>{unreadCount > 0 ? `${unreadCount} unread` : "You're all caught up"}</p>
              </div>
              <button
                type="button"
                className="app-notifications-mark-all"
                onClick={markAllRead}
                disabled={unreadCount === 0}
              >
                <CheckCheck aria-hidden="true" />
                Mark all read
              </button>
            </div>

            {visibleNotifications.length === 0 ? (
              <div className="app-notifications-empty">
                <Bell aria-hidden="true" />
                <p>You're all caught up</p>
              </div>
            ) : (
              <ul className="app-notifications-list">
                {visibleNotifications.map((notification) => (
                  <li key={notification.id}>
                    <NotificationItem
                      notification={notification}
                      onRead={(id) => {
                        markRead(id)
                        setOpen(false)
                      }}
                      onToggleRead={toggleRead}
                      onSnooze={snooze}
                      onDismiss={dismiss}
                      onAction={performAction}
                    />
                  </li>
                ))}
              </ul>
            )}

            <div className="app-notifications-panel-foot">
              <Link href="/dashboard/notifications" onClick={() => setOpen(false)}>
                View all notifications
              </Link>
              <Link
                href="/app/account/notifications"
                className="app-notifications-settings"
                onClick={() => setOpen(false)}
              >
                <Settings aria-hidden="true" />
                Preferences
              </Link>
            </div>
          </div>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  )
}
