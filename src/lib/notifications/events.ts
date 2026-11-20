/**
 * Wire contract for the notifications realtime channel.
 *
 * Transport: SSE at `GET /api/notifications/stream` (see
 * `src/app/api/notifications/stream/route.ts`). WebSocket upgrade is not
 * possible in App Router route handlers, so Server-Sent Events is the
 * realtime mechanism — the same choice `use-agent-run-stream` documents for
 * agent logs.
 *
 * Producers publish JSON events to `POST /api/notifications`; the server
 * fans them out to every connection held by the caller's principal (user id
 * in real-auth mode, mock-session email in mock-auth mode). This module is
 * isomorphic — safe to import from client and server code.
 */

import { isNotificationAction, isSafeNotificationHref, type NotificationAction } from "./actions"

export const NOTIFICATION_STREAM_PATH = "/api/notifications/stream"
export const NOTIFICATION_PUBLISH_PATH = "/api/notifications"

export const NOTIFICATION_TYPES = ["info", "success", "warning", "error"] as const
export type NotificationEventType = (typeof NOTIFICATION_TYPES)[number]

/**
 * Notification payload accepted over the wire. Mirrors
 * `AppNotificationInput` in `src/components/app/notifications-provider.tsx`;
 * kept structurally identical so the provider can ingest events without a
 * mapping layer. `id`, `createdAt`, `read`, `href`, `demo`, `projectId`,
 * `category`, `subject`, and `actions` are optional. `actions` entries are
 * validated with the same rules as `NotificationAction` in `./actions`.
 */
export interface NotificationPayload {
  type: NotificationEventType
  title: string
  body: string
  id?: string
  href?: string
  createdAt?: string
  read?: boolean
  demo?: boolean
  projectId?: string
  /** Category tag — drives per-category preference filtering. */
  category?: string
  /** Explicit thread subject; falls back to the normalized title. */
  subject?: string
  /** Inline action buttons rendered on the inbox row. */
  actions?: NotificationAction[]
}

/**
 * Events the stream can carry:
 *  - `notification` — a new/updated feed item (deduped by `id` client-side).
 *  - `read`         — one notification was marked read elsewhere.
 *  - `unread`       — one notification was marked unread elsewhere.
 *  - `read_all`     — the whole feed was marked read elsewhere.
 *  - `dismiss`      — one notification was removed from the feed elsewhere.
 */
export type NotificationStreamEvent =
  | { type: "notification"; notification: NotificationPayload }
  | { type: "read"; id: string }
  | { type: "unread"; id: string }
  | { type: "read_all" }
  | { type: "dismiss"; id: string }

const MAX_TITLE_LENGTH = 200
const MAX_BODY_LENGTH = 2000
const MAX_ID_LENGTH = 200

function isNotificationPayload(value: unknown): value is NotificationPayload {
  if (typeof value !== "object" || value === null) return false
  const candidate = value as Partial<NotificationPayload>
  return (
    typeof candidate.type === "string" &&
    (NOTIFICATION_TYPES as readonly string[]).includes(candidate.type) &&
    typeof candidate.title === "string" &&
    candidate.title.length > 0 &&
    candidate.title.length <= MAX_TITLE_LENGTH &&
    typeof candidate.body === "string" &&
    candidate.body.length <= MAX_BODY_LENGTH &&
    (candidate.id === undefined ||
      (typeof candidate.id === "string" && candidate.id.length <= MAX_ID_LENGTH)) &&
    (candidate.href === undefined || isSafeNotificationHref(candidate.href)) &&
    (candidate.createdAt === undefined || typeof candidate.createdAt === "string") &&
    (candidate.read === undefined || typeof candidate.read === "boolean") &&
    (candidate.demo === undefined || typeof candidate.demo === "boolean") &&
    (candidate.projectId === undefined ||
      (typeof candidate.projectId === "string" && candidate.projectId.length <= MAX_ID_LENGTH)) &&
    (candidate.category === undefined ||
      (typeof candidate.category === "string" && candidate.category.length <= 50)) &&
    (candidate.subject === undefined ||
      (typeof candidate.subject === "string" && candidate.subject.length <= 200)) &&
    (candidate.actions === undefined ||
      (Array.isArray(candidate.actions) &&
        candidate.actions.length <= 5 &&
        candidate.actions.every(isNotificationAction)))
  )
}

/** Runtime guard for untrusted JSON (POST bodies, SSE frames). */
export function isNotificationStreamEvent(value: unknown): value is NotificationStreamEvent {
  if (typeof value !== "object" || value === null) return false
  const candidate = value as { type?: unknown; notification?: unknown; id?: unknown }
  switch (candidate.type) {
    case "notification":
      return isNotificationPayload(candidate.notification)
    case "read":
    case "unread":
    case "dismiss":
      return (
        typeof candidate.id === "string" &&
        candidate.id.length > 0 &&
        candidate.id.length <= MAX_ID_LENGTH
      )
    case "read_all":
      return true
    default:
      return false
  }
}
