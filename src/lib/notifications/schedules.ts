import { isSafeNotificationHref } from "./actions"
import type { NotificationEventType } from "./events"

/**
 * Client-side scheduled notifications.
 *
 * Schedules live in localStorage (`spindle-notification-schedules`) and are
 * fired by `AppNotificationsProvider`: a single timer wakes at the earliest
 * pending `fireAt`, delivers the notification through the normal feed
 * pipeline (in-app + system notification + telemetry), then advances or
 * removes the schedule. Because everything is client-side, schedules only
 * fire while the app is open in a tab — a closed browser simply fires
 * overdue one-shot schedules on the next visit.
 *
 * This module is pure/isomorphic: no React, no DOM access except through the
 * guarded `load`/`save` helpers. All times are computed in local time —
 * `fireAt` is stored as an ISO instant, `time` as "HH:MM" wall-clock.
 */

export const NOTIFICATION_SCHEDULES_STORAGE_KEY = "spindle-notification-schedules"

export const NOTIFICATION_SCHEDULE_FREQUENCIES = ["once", "daily", "weekly"] as const
export type NotificationScheduleFrequency = (typeof NOTIFICATION_SCHEDULE_FREQUENCIES)[number]

export interface NotificationSchedule {
  id: string
  title: string
  body: string
  type: NotificationEventType
  /** Optional category tag — must be a known `AppNotificationCategory` to deliver. */
  category?: string
  href?: string
  frequency: NotificationScheduleFrequency
  /**
   * ISO instant of the next pending fire. For recurring schedules this is
   * advanced after every fire; for "once" the schedule is removed instead.
   */
  fireAt: string
  /** "HH:MM" local wall-clock time — required to compute recurring occurrences. */
  time?: string
  /** Weekday (0 = Sunday) the weekly schedule fires on. */
  weekday?: number
  enabled: boolean
  createdAt: string
  lastFiredAt?: string
}

export interface NotificationScheduleInput {
  title: string
  body?: string
  type?: NotificationEventType
  category?: string
  href?: string
  frequency: NotificationScheduleFrequency
  /**
   * ISO instant. Required for "once"; for recurring schedules it anchors the
   * first occurrence's weekday/time when `time` is not given explicitly.
   */
  fireAt?: string
  /** "HH:MM" local time — required for daily/weekly (derived from `fireAt` otherwise). */
  time?: string
  /**
   * Weekday (0 = Sunday) for weekly schedules. Defaults to the weekday of
   * the `fireAt` anchor; ignored for "once" and "daily".
   */
  weekday?: number
}

const MAX_SCHEDULES = 50
const MAX_TITLE_LENGTH = 200
const MAX_BODY_LENGTH = 2000
const MAX_HREF_LENGTH = 500
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/
const SCHEDULE_ID_PATTERN = /^sch_[a-z0-9_]+$/i

let scheduleCounter = 0

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function isValidTimestamp(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value))
}

function isValidTime(value: unknown): value is string {
  return typeof value === "string" && TIME_PATTERN.test(value)
}

function optionalString(value: unknown, max: number): string | undefined {
  return typeof value === "string" && value.length <= max ? value : undefined
}

/** Normalize one untrusted schedule; null when the payload is unusable. */
export function sanitizeNotificationSchedule(value: unknown): NotificationSchedule | null {
  if (!isRecord(value)) return null
  if (typeof value.id !== "string" || !SCHEDULE_ID_PATTERN.test(value.id)) return null
  if (typeof value.title !== "string" || value.title.trim().length === 0) return null
  if (value.title.length > MAX_TITLE_LENGTH) return null
  if (typeof value.frequency !== "string") return null
  if (!(NOTIFICATION_SCHEDULE_FREQUENCIES as readonly string[]).includes(value.frequency)) {
    return null
  }
  if (!isValidTimestamp(value.fireAt)) return null
  if (typeof value.createdAt !== "string" || Number.isNaN(Date.parse(value.createdAt))) {
    return null
  }

  const frequency = value.frequency as NotificationScheduleFrequency
  const schedule: NotificationSchedule = {
    id: value.id,
    title: value.title,
    body: typeof value.body === "string" ? value.body.slice(0, MAX_BODY_LENGTH) : "",
    type:
      value.type === "success" || value.type === "warning" || value.type === "error"
        ? value.type
        : "info",
    frequency,
    fireAt: new Date(Date.parse(value.fireAt)).toISOString(),
    enabled: value.enabled !== false,
    createdAt: new Date(Date.parse(value.createdAt)).toISOString(),
  }

  const category = optionalString(value.category, 50)
  if (category) schedule.category = category
  const href = optionalString(value.href, MAX_HREF_LENGTH)
  if (href && isSafeNotificationHref(href)) schedule.href = href
  if (isValidTime(value.time)) schedule.time = value.time
  if (
    typeof value.weekday === "number" &&
    Number.isInteger(value.weekday) &&
    value.weekday >= 0 &&
    value.weekday <= 6
  ) {
    schedule.weekday = value.weekday
  }
  if (isValidTimestamp(value.lastFiredAt)) {
    schedule.lastFiredAt = new Date(Date.parse(value.lastFiredAt)).toISOString()
  }

  // Recurring schedules without a usable wall-clock time can never compute a
  // next occurrence — drop them rather than store a zombie.
  if (frequency !== "once" && !schedule.time) return null

  return schedule
}

/** Normalize an untrusted schedule list (localStorage, storage events). */
export function sanitizeNotificationSchedules(value: unknown): NotificationSchedule[] {
  if (!Array.isArray(value)) return []
  const schedules: NotificationSchedule[] = []
  const seen = new Set<string>()
  for (const entry of value) {
    const schedule = sanitizeNotificationSchedule(entry)
    if (!schedule || seen.has(schedule.id)) continue
    seen.add(schedule.id)
    schedules.push(schedule)
    if (schedules.length >= MAX_SCHEDULES) break
  }
  return schedules
}

/** Read persisted schedules; empty array on SSR, missing, or corrupt storage. */
export function loadNotificationSchedules(): NotificationSchedule[] {
  if (typeof window === "undefined") return []
  try {
    const raw = window.localStorage.getItem(NOTIFICATION_SCHEDULES_STORAGE_KEY)
    if (!raw) return []
    return sanitizeNotificationSchedules(JSON.parse(raw))
  } catch {
    return []
  }
}

/** Persist schedules; storage failures are ignored (session state still applies). */
export function saveNotificationSchedules(schedules: readonly NotificationSchedule[]): void {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(
      NOTIFICATION_SCHEDULES_STORAGE_KEY,
      JSON.stringify(schedules.slice(0, MAX_SCHEDULES)),
    )
  } catch {
    // Private mode / quota — schedules still work for this session.
  }
}

/** "HH:MM" local wall-clock time for an instant. */
export function wallClockTimeOf(date: Date): string {
  const hours = String(date.getHours()).padStart(2, "0")
  const minutes = String(date.getMinutes()).padStart(2, "0")
  return `${hours}:${minutes}`
}

/**
 * Next occurrence of a recurring schedule strictly after `from`, as epoch ms.
 * Returns null for "once" schedules, missing/invalid times, and exhausted
 * searches. Weekly schedules fire on `schedule.weekday` (default: the
 * weekday of `from`).
 */
export function nextRecurringFireAt(
  schedule: Pick<NotificationSchedule, "frequency" | "time" | "weekday">,
  from: number = Date.now(),
): number | null {
  if (schedule.frequency === "once") return null
  const time = schedule.time
  if (!time || !TIME_PATTERN.test(time)) return null

  const [hours, minutes] = time.split(":").map(Number)
  const fromDate = new Date(from)

  if (schedule.frequency === "daily") {
    for (let addDays = 0; addDays <= 1; addDays += 1) {
      const candidate = new Date(fromDate)
      candidate.setDate(candidate.getDate() + addDays)
      candidate.setHours(hours, minutes, 0, 0)
      if (candidate.getTime() > from) return candidate.getTime()
    }
    return null
  }

  // weekly
  const weekday = schedule.weekday ?? fromDate.getDay()
  for (let addDays = 0; addDays <= 7; addDays += 1) {
    const candidate = new Date(fromDate)
    candidate.setDate(candidate.getDate() + addDays)
    if (candidate.getDay() !== weekday) continue
    candidate.setHours(hours, minutes, 0, 0)
    if (candidate.getTime() > from) return candidate.getTime()
  }
  return null
}

/**
 * Build a schedule from user input. Returns null when the input cannot
 * produce a valid schedule (missing title, "once" without a parseable
 * fireAt, recurring without a derivable time).
 */
export function buildNotificationSchedule(
  input: NotificationScheduleInput,
  now: Date = new Date(),
): NotificationSchedule | null {
  const title = input.title.trim()
  if (!title || title.length > MAX_TITLE_LENGTH) return null
  if (!(NOTIFICATION_SCHEDULE_FREQUENCIES as readonly string[]).includes(input.frequency)) {
    return null
  }

  const frequency = input.frequency
  const anchorTime =
    input.fireAt && !Number.isNaN(Date.parse(input.fireAt))
      ? Date.parse(input.fireAt)
      : now.getTime()
  const anchor = new Date(anchorTime)
  const requestedWeekday =
    typeof input.weekday === "number" &&
    Number.isInteger(input.weekday) &&
    input.weekday >= 0 &&
    input.weekday <= 6
      ? input.weekday
      : undefined

  let fireAt: string
  let time: string | undefined
  let weekday: number | undefined

  if (frequency === "once") {
    if (!input.fireAt || Number.isNaN(Date.parse(input.fireAt))) return null
    fireAt = new Date(Date.parse(input.fireAt)).toISOString()
  } else {
    time = isValidTime(input.time) ? input.time : wallClockTimeOf(anchor)
    weekday = requestedWeekday ?? anchor.getDay()
    const draft: NotificationSchedule = {
      id: "sch_pending",
      title,
      body: "",
      type: "info",
      frequency,
      fireAt: anchor.toISOString(),
      time,
      weekday,
      enabled: true,
      createdAt: anchor.toISOString(),
    }
    const next = nextRecurringFireAt(draft, now.getTime())
    if (next === null) return null
    fireAt = new Date(next).toISOString()
  }

  scheduleCounter += 1
  const schedule: NotificationSchedule = {
    id: `sch_${Date.now().toString(36)}_${scheduleCounter.toString(36)}`,
    title,
    body: (input.body ?? "").slice(0, MAX_BODY_LENGTH),
    type:
      input.type === "success" || input.type === "warning" || input.type === "error"
        ? input.type
        : "info",
    frequency,
    fireAt,
    enabled: true,
    createdAt: now.toISOString(),
  }
  const category = optionalString(input.category, 50)
  if (category) schedule.category = category
  const href = optionalString(input.href, MAX_HREF_LENGTH)
  if (href && isSafeNotificationHref(href)) schedule.href = href
  if (time) schedule.time = time
  if (weekday !== undefined) schedule.weekday = weekday

  return schedule
}

/**
 * Advance the schedule list after `id` fired at `firedAtMs`: one-shot
 * schedules are removed, recurring schedules get their next `fireAt` and a
 * `lastFiredAt` stamp. Returns the input array unchanged when the id is
 * unknown. Pure — the caller persists the result.
 */
export function advanceNotificationSchedule(
  schedules: readonly NotificationSchedule[],
  id: string,
  firedAtMs: number,
): NotificationSchedule[] {
  const fired = schedules.find((schedule) => schedule.id === id)
  if (!fired) return [...schedules]

  if (fired.frequency === "once") {
    return schedules.filter((schedule) => schedule.id !== id)
  }

  const next = nextRecurringFireAt(fired, firedAtMs)
  const lastFiredAt = new Date(firedAtMs).toISOString()
  return schedules
    .filter((schedule) => schedule.id !== id)
    .concat(
      next === null
        ? []
        : [
            {
              ...fired,
              fireAt: new Date(next).toISOString(),
              lastFiredAt,
            },
          ],
    )
}
