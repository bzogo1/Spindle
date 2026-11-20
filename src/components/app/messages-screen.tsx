"use client"

import { useCallback, useEffect, useState } from "react"
import {
  AlertTriangle,
  CheckCheck,
  CheckCircle2,
  ChevronDown,
  Inbox,
  Info,
  Megaphone,
} from "lucide-react"

import { EmptyState } from "@/components/app/states/empty-state"
import { InlineError } from "@/components/app/states/inline-error"
import { LoadingPanel } from "@/components/app/states/loading-panel"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import type { InboxMessage, MessageKind } from "@/lib/in-app-messages"

/**
 * "Messages" screen for `/app/messages`: the signed-in user's inbox of
 * in-app messages — direct notes from admins plus broadcast announcements —
 * fetched from `GET /api/messages`.
 *
 * Expanding an unread message POSTs `{ messageId }` to mark it read;
 * "Mark all read" POSTs `{ all: true }`. Both responses carry the fresh
 * `unreadCount`, which the header bell (`MessagesBell`) picks up on its next
 * poll. Broadcasts (`userId: null`) show a megaphone marker.
 */

const MESSAGES_API = "/api/messages"

interface MessagesResponse {
  ok: boolean
  messages?: InboxMessage[]
  unreadCount?: number
  message?: string
}

const KIND_META: Record<
  MessageKind,
  { label: string; icon: typeof Info; badgeVariant: "secondary" | "destructive" | "outline" }
> = {
  info: { label: "Info", icon: Info, badgeVariant: "outline" },
  warning: { label: "Warning", icon: AlertTriangle, badgeVariant: "destructive" },
  success: { label: "Success", icon: CheckCircle2, badgeVariant: "secondary" },
}

function formatTimestamp(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  })
}

export function MessagesScreen() {
  const [messages, setMessages] = useState<InboxMessage[] | null>(null)
  const [unreadCount, setUnreadCount] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [markingAll, setMarkingAll] = useState(false)

  const load = useCallback(async () => {
    setError(null)
    try {
      const response = await fetch(MESSAGES_API, { cache: "no-store" })
      const data = (await response.json()) as MessagesResponse
      if (!response.ok || !data.ok) {
        setError(data.message ?? "Could not load your messages.")
        setMessages([])
        return
      }
      setMessages(data.messages ?? [])
      setUnreadCount(data.unreadCount ?? 0)
    } catch {
      setError("Could not load your messages. Check your connection and try again.")
      setMessages([])
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const markRead = useCallback(async (messageId: string) => {
    try {
      const response = await fetch(MESSAGES_API, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messageId }),
      })
      const data = (await response.json()) as MessagesResponse
      if (response.ok && data.ok) {
        setUnreadCount(data.unreadCount ?? 0)
        setMessages(
          (current) =>
            current?.map((message) =>
              message.id === messageId
                ? { ...message, read: true, readAt: new Date().toISOString() }
                : message,
            ) ?? current,
        )
      }
    } catch {
      // Read receipts are best-effort; the next inbox load reconciles.
    }
  }, [])

  const markAll = useCallback(async () => {
    setMarkingAll(true)
    try {
      const response = await fetch(MESSAGES_API, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ all: true }),
      })
      const data = (await response.json()) as MessagesResponse
      if (response.ok && data.ok) {
        setUnreadCount(data.unreadCount ?? 0)
        setMessages(
          (current) =>
            current?.map((message) => ({
              ...message,
              read: true,
              readAt: message.readAt ?? new Date().toISOString(),
            })) ?? current,
        )
      }
    } catch {
      // Same best-effort semantics as markRead.
    } finally {
      setMarkingAll(false)
    }
  }, [])

  const toggleMessage = useCallback(
    (message: InboxMessage) => {
      const next = expandedId === message.id ? null : message.id
      setExpandedId(next)
      if (next !== null && !message.read) {
        void markRead(message.id)
      }
    },
    [expandedId, markRead],
  )

  const loading = messages === null && error === null
  const empty = messages !== null && messages.length === 0

  return (
    <section className="app-panel" aria-labelledby="messages-heading">
      <div className="app-panel-head">
        <div>
          <h2 id="messages-heading">Inbox</h2>
          <p>
            Direct messages from the Spindle team and broadcast announcements.
            {unreadCount > 0 ? ` ${unreadCount} unread.` : ""}
          </p>
        </div>
        <div className="app-panel-head-actions">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void markAll()}
            disabled={unreadCount === 0 || markingAll}
          >
            <CheckCheck aria-hidden="true" />
            Mark all read
          </Button>
        </div>
      </div>

      {error ? (
        <InlineError
          title="Messages unavailable"
          message={
            <span className="flex flex-wrap items-center gap-2">
              <span>{error}</span>
              <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
                Retry
              </Button>
            </span>
          }
        />
      ) : null}

      {loading ? (
        <LoadingPanel label="Loading messages" variant="table" />
      ) : empty ? (
        <EmptyState
          icon={<Inbox aria-hidden="true" />}
          title="No messages"
          body="When the Spindle team sends you a message or posts an announcement, it will show up here."
        />
      ) : (
        <ul className="app-messages-list">
          {messages?.map((message) => {
            const meta = KIND_META[message.kind]
            const KindIcon = meta.icon
            const expanded = expandedId === message.id
            return (
              <li
                key={message.id}
                className="app-messages-item"
                data-unread={!message.read || undefined}
              >
                <button
                  type="button"
                  className="app-messages-toggle"
                  aria-expanded={expanded}
                  onClick={() => toggleMessage(message)}
                >
                  <span className="app-messages-kind" data-kind={message.kind} aria-hidden="true">
                    <KindIcon />
                  </span>
                  <span className="app-messages-summary">
                    <span className="app-messages-subject">
                      {!message.read ? (
                        <span className="app-messages-unread-dot" aria-label="Unread" />
                      ) : null}
                      {message.subject}
                      {message.userId === null ? (
                        <Badge variant="outline" size="sm" className="app-messages-broadcast">
                          <Megaphone aria-hidden="true" />
                          Announcement
                        </Badge>
                      ) : null}
                    </span>
                    <span className="app-messages-meta">
                      <Badge variant={meta.badgeVariant} size="sm">
                        {meta.label}
                      </Badge>
                      <time dateTime={message.createdAt}>{formatTimestamp(message.createdAt)}</time>
                      {message.readAt ? <span>Read {formatTimestamp(message.readAt)}</span> : null}
                    </span>
                  </span>
                  <ChevronDown aria-hidden="true" className={expanded ? "is-open" : undefined} />
                </button>
                {expanded ? (
                  <div className="app-messages-body">
                    <p className="whitespace-pre-wrap">{message.body}</p>
                  </div>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
