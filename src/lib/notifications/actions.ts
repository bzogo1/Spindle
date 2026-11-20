import { trackEvent } from "@/lib/analytics"

/**
 * Actionable notifications.
 *
 * Producers can attach `actions` to a notification; the inbox renders them as
 * inline buttons next to the built-in controls (mark read/unread, snooze,
 * dismiss). An action is declarative — `href` navigates, `snoozeMinutes`
 * snoozes, `dismiss` removes the item — so the same payload works over the
 * realtime wire (`events.ts`) and in locally produced notifications.
 *
 * When an action sets several fields at once, activation precedence is
 * `dismiss` > `snoozeMinutes` > `href` (custom/mark-read) — see
 * `performAction` in `notifications-provider.tsx`. Producers should set at
 * most one behavior field per action.
 *
 * This module is isomorphic: no React, no DOM. Telemetry goes through
 * `trackEvent`, which is consent-gated and drops non-identifying props only.
 */

export interface NotificationAction {
  /** Stable id — used for telemetry and React keys. */
  id: string
  /** Button label. */
  label: string
  /** SPA destination rendered as a link when present. */
  href?: string
  /** Snooze the notification for this many minutes when activated. */
  snoozeMinutes?: number
  /** Remove the notification from the feed when activated. */
  dismiss?: boolean
}

const MAX_ACTIONS = 5
const MAX_ACTION_ID_LENGTH = 80
const MAX_ACTION_LABEL_LENGTH = 80
const MAX_HREF_LENGTH = 500
/** One week — longer snoozes are almost certainly a mistake. */
export const MAX_SNOOZE_MINUTES = 7 * 24 * 60

/**
 * URLs a notification may link to: same-origin relative references
 * (`/app/files`, `#section`, `?query`) and absolute `http:`, `https:`, or
 * `mailto:` URLs. Everything else — `javascript:`, `data:`, `vbscript:`,
 * protocol-relative `//host` — is rejected so a hostile payload cannot
 * smuggle script or an off-origin redirect into a rendered link. Shared by
 * the wire guard (`events.ts`), action validation, schedule sanitizing, and
 * the provider's `toNotification`.
 */
export function isSafeNotificationHref(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_HREF_LENGTH) {
    return false
  }
  if (value.startsWith("//")) return false
  if (value.startsWith("/") || value.startsWith("#") || value.startsWith("?")) return true
  try {
    const protocol = new URL(value).protocol
    return protocol === "https:" || protocol === "http:" || protocol === "mailto:"
  } catch {
    return false
  }
}

export function isNotificationAction(value: unknown): value is NotificationAction {
  if (typeof value !== "object" || value === null) return false
  const candidate = value as Partial<NotificationAction>
  return (
    typeof candidate.id === "string" &&
    candidate.id.length > 0 &&
    candidate.id.length <= MAX_ACTION_ID_LENGTH &&
    typeof candidate.label === "string" &&
    candidate.label.length > 0 &&
    candidate.label.length <= MAX_ACTION_LABEL_LENGTH &&
    (candidate.href === undefined || isSafeNotificationHref(candidate.href)) &&
    (candidate.snoozeMinutes === undefined ||
      (typeof candidate.snoozeMinutes === "number" &&
        Number.isFinite(candidate.snoozeMinutes) &&
        candidate.snoozeMinutes > 0 &&
        candidate.snoozeMinutes <= MAX_SNOOZE_MINUTES)) &&
    (candidate.dismiss === undefined || typeof candidate.dismiss === "boolean")
  )
}

/** Validate an untrusted actions array (wire payloads, storage). */
export function sanitizeNotificationActions(value: unknown): NotificationAction[] | undefined {
  if (!Array.isArray(value)) return undefined
  const actions = value.filter(isNotificationAction).slice(0, MAX_ACTIONS)
  return actions.length > 0 ? actions : undefined
}

/** Analytics event name for notification interactions. */
export const NOTIFICATION_ACTION_EVENT = "notification_action"

export type NotificationActionKind =
  "mark_read" | "mark_unread" | "mark_all_read" | "snooze" | "dismiss" | "custom"

/**
 * Record a notification interaction. Routed through the consent-gated
 * analytics pipeline — nothing is sent without analytics consent. Props stay
 * aggregate: action kind, optional action id, and the notification category.
 * Titles, bodies, hrefs, and user identifiers are never included.
 */
export function trackNotificationAction(
  kind: NotificationActionKind,
  context?: { category?: string; actionId?: string },
): void {
  trackEvent(NOTIFICATION_ACTION_EVENT, {
    kind,
    ...(context?.actionId ? { actionId: context.actionId } : {}),
    ...(context?.category ? { category: context.category } : {}),
  })
}

/* ------------------------------------------------------------------ */
/* Snooze presets                                                      */
/* ------------------------------------------------------------------ */

export interface SnoozePreset {
  id: string
  label: string
  /** Fixed offset in minutes; absent for clock-time presets. */
  minutes?: number
}

export const SNOOZE_PRESETS: readonly SnoozePreset[] = [
  { id: "30m", label: "30 minutes", minutes: 30 },
  { id: "1h", label: "1 hour", minutes: 60 },
  { id: "tomorrow", label: "Tomorrow at 9:00" },
  { id: "next-week", label: "Next week" },
]

/**
 * Resolve a snooze preset to an ISO timestamp. `tomorrow` means 09:00 local
 * time the next calendar day; `next-week` means the same time seven days
 * out. Returns null for unknown preset ids.
 */
export function snoozeUntilFor(presetId: string, now: Date = new Date()): string | null {
  const preset = SNOOZE_PRESETS.find((candidate) => candidate.id === presetId)
  if (!preset) return null

  if (preset.minutes !== undefined) {
    return new Date(now.getTime() + preset.minutes * 60_000).toISOString()
  }

  const until = new Date(now)
  if (preset.id === "tomorrow") {
    until.setDate(until.getDate() + 1)
    until.setHours(9, 0, 0, 0)
    return until.toISOString()
  }

  // "next-week": same wall-clock time, seven days later.
  until.setDate(until.getDate() + 7)
  return until.toISOString()
}
