import { FALLBACK_TIME_ZONE, getUtcOffsetMs, isValidTimeZone } from "@/lib/timezone"
import type { EvaluationContext, StrategyFn, StrategyOutcome } from "./types"

/**
 * Scheduled rollout: enable the flag inside configured time windows.
 *
 * Two window shapes are supported:
 *
 * One-off absolute window (ISO 8601 timestamps, `endAt` exclusive):
 * ```ts
 * { startAt: "2025-03-01T09:00:00Z", endAt: "2025-03-15T18:00:00Z" }
 * ```
 *
 * Recurring daily window ("HH:mm" wall-clock times in `timezone`, default
 * UTC; `days` uses JS convention 0=Sunday … 6=Saturday; windows where
 * `end < start` wrap past midnight):
 * ```ts
 * { start: "09:00", end: "17:00", timezone: "Europe/Kyiv", days: [1,2,3,4,5] }
 * ```
 *
 * Config:
 * ```ts
 * { windows: ScheduleWindow[], timezone?: string }
 * ```
 *
 * The flag is enabled while `now` falls inside ANY window and disabled
 * otherwise. An empty `windows` array abstains (`null`).
 *
 * Daily windows compare wall-clock time in the configured IANA zone via
 * `Intl`, so DST transitions are handled naturally: the window follows local
 * time (e.g. "09:00" stays 09:00 local across a DST change). A wall-clock
 * time that does not exist on a spring-forward day simply never matches.
 */
export type ScheduleWindow =
  | { startAt: string; endAt: string }
  | { start: string; end: string; timezone?: string; days?: readonly number[] }

export interface ScheduleConfig {
  windows: readonly ScheduleWindow[]
  timezone?: string
}

/** Wall-clock parts of `date` in `timeZone`: weekday (0=Sun), hour, minute. */
function zonedParts(date: Date, timeZone: string): { day: number; hour: number; minute: number } {
  const offset = getUtcOffsetMs(timeZone, date)
  const local = new Date(date.getTime() + offset)
  return {
    day: local.getUTCDay(),
    hour: local.getUTCHours(),
    minute: local.getUTCMinutes(),
  }
}

function parseHHmm(value: string, field: string): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value)
  if (!match) {
    throw new TypeError(`schedule window ${field} must be "HH:mm", got "${value}"`)
  }
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (hour > 23 || minute > 59) {
    throw new TypeError(`schedule window ${field} out of range: "${value}"`)
  }
  return hour * 60 + minute
}

function resolveZone(configured: string | undefined, fallback: string | undefined): string {
  for (const candidate of [configured, fallback, FALLBACK_TIME_ZONE]) {
    if (candidate !== undefined && isValidTimeZone(candidate)) return candidate
  }
  return FALLBACK_TIME_ZONE
}

function isOnceWindow(window: ScheduleWindow): window is { startAt: string; endAt: string } {
  return typeof (window as { startAt?: unknown }).startAt === "string"
}

function windowMatches(
  window: ScheduleWindow,
  now: Date,
  defaultZone: string | undefined,
): boolean {
  if (isOnceWindow(window)) {
    const start = Date.parse(window.startAt)
    const end = Date.parse(window.endAt)
    if (Number.isNaN(start) || Number.isNaN(end)) {
      throw new TypeError(
        `schedule one-off window has invalid timestamps: "${window.startAt}" → "${window.endAt}"`,
      )
    }
    const t = now.getTime()
    return t >= start && t < end
  }

  const daily = window as {
    start: string
    end: string
    timezone?: string
    days?: readonly number[]
  }
  if (typeof daily.start !== "string" || typeof daily.end !== "string") {
    throw new TypeError('schedule daily window requires `start` and `end` ("HH:mm")')
  }
  const startMin = parseHHmm(daily.start, "start")
  const endMin = parseHHmm(daily.end, "end")

  if (daily.days !== undefined) {
    if (
      !Array.isArray(daily.days) ||
      daily.days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)
    ) {
      throw new TypeError("schedule window `days` must be integers 0–6 (0=Sunday)")
    }
  }

  const zone = resolveZone(daily.timezone, defaultZone)
  const parts = zonedParts(now, zone)
  if (daily.days !== undefined && !daily.days.includes(parts.day)) return false

  const t = parts.hour * 60 + parts.minute
  // `end == start` is treated as a zero-length window that never matches,
  // avoiding the ambiguity of "all day" vs "never".
  if (endMin <= startMin) {
    return endMin < startMin && (t >= startMin || t < endMin)
  }
  return t >= startMin && t < endMin
}

function parseConfig(config: unknown): ScheduleConfig {
  if (typeof config !== "object" || config === null) {
    throw new TypeError("schedule strategy requires a config object")
  }
  const raw = config as Record<string, unknown>
  if (!Array.isArray(raw.windows)) {
    throw new TypeError("schedule strategy requires a `windows` array")
  }
  const timezone = typeof raw.timezone === "string" ? raw.timezone : undefined
  return { windows: raw.windows as readonly ScheduleWindow[], timezone }
}

function run(config: unknown, ctx: EvaluationContext, now: Date): StrategyOutcome {
  void ctx
  const cfg = parseConfig(config)
  if (cfg.windows.length === 0) {
    return { verdict: null, reason: "schedule has no windows configured" }
  }
  for (const window of cfg.windows) {
    if (windowMatches(window, now, cfg.timezone)) {
      return { verdict: true, reason: "now is inside a schedule window" }
    }
  }
  return { verdict: false, reason: "now is outside all schedule windows" }
}

export const scheduleStrategy: StrategyFn = (config, ctx, now) => run(config, ctx, now)
