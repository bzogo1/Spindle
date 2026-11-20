import { randomUUID } from "node:crypto"

/**
 * In-app message store — the user inbox behind `/app/messages`.
 *
 * Two kinds of messages land here:
 *  - **Direct** messages addressed to one principal (`userId` set), sent by
 *    admins via `POST /api/admin/messages`.
 *  - **Broadcast** announcements (`userId: null`) delivered to every inbox.
 *
 * DEVELOPMENT SEAM: state lives in a process-local `Map`, same interim-store
 * pattern as `contact-routing.ts` / `newsletter-store.ts`. Per-instance only
 * — messages are invisible to other instances and lost on restart. The
 * upgrade path is a `Message` + `MessageRead` table; the exported signatures
 * are already shaped for that swap. Bounded at
 * `MESSAGE_STORE_MAX_MESSAGES` records (oldest evicted first).
 *
 * Read state is per-user: each message keeps a `readBy` map of
 * `principal -> ISO timestamp`, so one user opening a broadcast does not
 * mark it read for anyone else.
 *
 * Server-only in practice: imported by route handlers and API tests; client
 * components must not import it at runtime. The inbox UI talks to
 * `/api/messages` and uses `import type` only.
 */

export const MESSAGE_STORE_MAX_MESSAGES = 1000
export const MESSAGE_SUBJECT_MAX_LENGTH = 200
export const MESSAGE_BODY_MAX_LENGTH = 10_000
export const MESSAGE_ID_MAX_LENGTH = 120

export const MESSAGE_KINDS = ["info", "warning", "success"] as const
export type MessageKind = (typeof MESSAGE_KINDS)[number]

export interface InAppMessage {
  id: string
  /**
   * Recipient principal: the auth user's id for real sessions, or
   * `mock:<email>` for mock-auth sessions. `null` means broadcast —
   * delivered to every inbox.
   */
  userId: string | null
  subject: string
  body: string
  kind: MessageKind
  createdAt: string
  /** principal -> ISO timestamp of when that user marked the message read. */
  readBy: Record<string, string>
}

/**
 * A message as seen by one inbox: the stored record plus that user's read
 * state resolved to a single `read`/`readAt` pair.
 */
export interface InboxMessage {
  id: string
  /** `null` for broadcast announcements. */
  userId: string | null
  subject: string
  body: string
  kind: MessageKind
  createdAt: string
  read: boolean
  readAt?: string
}

export interface SendMessageInput {
  /** Omit (or pass null) for a broadcast to every inbox. */
  userId?: string | null
  subject: string
  body: string
  kind: MessageKind
}

const messages = new Map<string, InAppMessage>() // id → record, insertion-ordered

function nowIso(): string {
  return new Date().toISOString()
}

function isVisibleTo(message: InAppMessage, userId: string): boolean {
  return message.userId === null || message.userId === userId
}

function toInboxMessage(message: InAppMessage, userId: string): InboxMessage {
  const readAt = message.readBy[userId]
  return {
    id: message.id,
    userId: message.userId,
    subject: message.subject,
    body: message.body,
    kind: message.kind,
    createdAt: message.createdAt,
    read: readAt !== undefined,
    ...(readAt ? { readAt } : {}),
  }
}

function sortedVisible(userId: string): InAppMessage[] {
  // Iterate newest-inserted first, then stable-sort by createdAt desc so
  // messages sharing a millisecond still surface newest-first.
  return [...messages.values()]
    .reverse()
    .filter((message) => isVisibleTo(message, userId))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

/**
 * Records a message. `userId` omitted/null produces a broadcast visible to
 * every inbox; a concrete id targets a single principal. Returns the stored
 * record (with an empty `readBy` map).
 */
export function sendMessage(input: SendMessageInput): InAppMessage {
  const id = `msg_${randomUUID()}`
  const userId = input.userId?.trim() ? input.userId.trim() : null
  const message: InAppMessage = {
    id,
    userId,
    subject: input.subject.trim(),
    body: input.body.trim(),
    kind: input.kind,
    createdAt: nowIso(),
    readBy: {},
  }

  // Bounded capacity: evict the oldest record (Map preserves insertion
  // order) so a flood cannot grow memory without limit.
  if (messages.size >= MESSAGE_STORE_MAX_MESSAGES && !messages.has(id)) {
    const oldest = messages.keys().next().value
    if (oldest !== undefined) messages.delete(oldest)
  }
  messages.set(id, message)
  return message
}

/**
 * Returns the caller's inbox — direct messages plus broadcasts — newest
 * first, capped at `limit` (default: all). Each item carries the caller's
 * own `read`/`readAt` state.
 */
export function listInbox(userId: string, limit?: number): InboxMessage[] {
  const visible = sortedVisible(userId)
  const capped = limit !== undefined ? visible.slice(0, Math.max(0, limit)) : visible
  return capped.map((message) => toInboxMessage(message, userId))
}

/** Number of inbox messages the user has not marked read. */
export function unreadCount(userId: string): number {
  return sortedVisible(userId).filter((message) => message.readBy[userId] === undefined).length
}

/**
 * Marks one message read for `userId`. Returns true when the message exists
 * and is visible to the user (already-read messages count as success —
 * marking read is idempotent).
 */
export function markRead(userId: string, messageId: string): boolean {
  const message = messages.get(messageId)
  if (!message || !isVisibleTo(message, userId)) return false
  if (message.readBy[userId] === undefined) {
    message.readBy[userId] = nowIso()
  }
  return true
}

/**
 * Marks every currently-unread inbox message read for `userId`. Returns the
 * number of messages that transitioned to read.
 */
export function markAllRead(userId: string): number {
  const now = nowIso()
  let marked = 0
  for (const message of messages.values()) {
    if (isVisibleTo(message, userId) && message.readBy[userId] === undefined) {
      message.readBy[userId] = now
      marked += 1
    }
  }
  return marked
}

/**
 * Admin view: direct (non-broadcast) messages, newest first, capped at
 * `limit`. Broadcasts are excluded — they are announcements, not sends to a
 * known recipient.
 */
export function listSentMessages(limit?: number): InAppMessage[] {
  const sent = [...messages.values()]
    .reverse()
    .filter((message) => message.userId !== null)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  return limit !== undefined ? sent.slice(0, Math.max(0, limit)) : sent
}

/** Test hook: clears all recorded messages. */
export function clearInAppMessages(): void {
  messages.clear()
}
