import type { ActivityEvent, ActivityKind } from "../api/types"

/**
 * Wire contract for the project-activity realtime channel.
 *
 * Transport: SSE at `GET /api/activity/stream` (see
 * `src/app/api/activity/stream/route.ts`) — the same mechanism the
 * notifications channel uses (`src/lib/notifications/events.ts`); App Router
 * route handlers cannot upgrade to WebSocket.
 *
 * Producers publish a single `ActivityStreamEvent` to `POST /api/activity`;
 * the server fans it out to every stream connection held by the caller's
 * principal. Client-side producers additionally deliver in-tab via the
 * `ACTIVITY_LIVE_EVENT` CustomEvent and cross-tab via the
 * `ACTIVITY_BROADCAST_CHANNEL` BroadcastChannel (see
 * `src/lib/activity/client.ts`), matching the notifications provider's
 * three-path delivery.
 *
 * This module is isomorphic — safe to import from client and server code.
 */

export const ACTIVITY_STREAM_PATH = "/api/activity/stream"
export const ACTIVITY_PUBLISH_PATH = "/api/activity"

/** window CustomEvent name for same-tab live delivery. */
export const ACTIVITY_LIVE_EVENT = "spindle:activity-event"
/** BroadcastChannel name for cross-tab live delivery (same origin). */
export const ACTIVITY_BROADCAST_CHANNEL = "spindle-activity"

export const ACTIVITY_KINDS: readonly ActivityKind[] = [
  "project",
  "file",
  "lab",
  "chat",
  "agent",
  "system",
]

/** Events the stream can carry. Activity is append-only, so a single shape suffices. */
export type ActivityStreamEvent = { type: "activity"; activity: ActivityEvent }

const MAX_ID_LENGTH = 200
const MAX_NAME_LENGTH = 200
const MAX_SUMMARY_LENGTH = 500
const MAX_TARGET_LENGTH = 300

function isOptionalString(value: unknown, maxLength: number): boolean {
  return value === undefined || (typeof value === "string" && value.length <= maxLength)
}

/** Runtime guard for an untrusted `ActivityEvent` (CustomEvent detail, BroadcastChannel data). */
export function isActivityEvent(value: unknown): value is ActivityEvent {
  if (typeof value !== "object" || value === null) return false
  const candidate = value as Partial<ActivityEvent>
  const actor = candidate.actor as Partial<ActivityEvent["actor"]> | undefined
  return (
    typeof candidate.id === "string" &&
    candidate.id.length > 0 &&
    candidate.id.length <= MAX_ID_LENGTH &&
    typeof candidate.kind === "string" &&
    (ACTIVITY_KINDS as readonly string[]).includes(candidate.kind) &&
    typeof candidate.summary === "string" &&
    candidate.summary.length > 0 &&
    candidate.summary.length <= MAX_SUMMARY_LENGTH &&
    typeof candidate.createdAt === "string" &&
    candidate.createdAt.length > 0 &&
    isOptionalString(candidate.projectId, MAX_ID_LENGTH) &&
    isOptionalString(candidate.projectName, MAX_NAME_LENGTH) &&
    isOptionalString(candidate.target, MAX_TARGET_LENGTH) &&
    typeof actor === "object" &&
    actor !== null &&
    typeof actor.id === "string" &&
    actor.id.length > 0 &&
    actor.id.length <= MAX_ID_LENGTH &&
    typeof actor.name === "string" &&
    actor.name.length > 0 &&
    actor.name.length <= MAX_NAME_LENGTH &&
    isOptionalString(actor.avatarUrl, 500)
  )
}

/** Runtime guard for untrusted JSON (POST bodies, SSE frames). */
export function isActivityStreamEvent(value: unknown): value is ActivityStreamEvent {
  if (typeof value !== "object" || value === null) return false
  const candidate = value as { type?: unknown; activity?: unknown }
  return candidate.type === "activity" && isActivityEvent(candidate.activity)
}
