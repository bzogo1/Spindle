"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Inbox } from "lucide-react"

/**
 * Header bell linking to `/app/messages`. Fetches the unread count from
 * `GET /api/messages?unread=1&limit=1` on mount and re-polls every 60s —
 * deliberately light: the full inbox loads on the messages page itself.
 * Renders nothing extra when signed out or when the request fails (the
 * badge simply stays hidden), so it never breaks the top bar.
 */

const MESSAGES_API = "/api/messages?unread=1&limit=1"
const POLL_INTERVAL_MS = 60_000

interface MessagesCountResponse {
  ok: boolean
  unreadCount?: number
}

export function MessagesBell() {
  const [unreadCount, setUnreadCount] = useState(0)

  useEffect(() => {
    let cancelled = false

    async function refresh() {
      try {
        const response = await fetch(MESSAGES_API, { cache: "no-store" })
        const data = (await response.json()) as MessagesCountResponse
        if (!cancelled && response.ok && data.ok) {
          setUnreadCount(data.unreadCount ?? 0)
        }
      } catch {
        // Badge is best-effort; the inbox page surfaces real errors.
      }
    }

    void refresh()
    const interval = setInterval(() => void refresh(), POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [])

  const badgeLabel = unreadCount > 99 ? "99+" : String(unreadCount)

  return (
    <Link
      href="/app/messages"
      className="app-icon-button app-messages-trigger"
      aria-label={unreadCount > 0 ? `Messages, ${unreadCount} unread` : "Messages"}
    >
      <span className="app-notification-icon">
        <Inbox aria-hidden="true" />
        {unreadCount > 0 ? (
          <span className="app-notification-badge" aria-hidden="true">
            {badgeLabel}
          </span>
        ) : null}
      </span>
    </Link>
  )
}
