/**
 * Timezone detection and formatting helpers.
 *
 * Everything here is pure and unit-testable: callers can inject a `Date` and
 * an IANA zone name instead of relying on the current clock or the runtime's
 * detected zone. Detection itself goes through
 * `Intl.DateTimeFormat().resolvedOptions().timeZone` and always falls back to
 * UTC when the runtime reports nothing usable.
 */

export const FALLBACK_TIME_ZONE = "UTC"

/**
 * A short list of widely used IANA zones for pickers and display fallbacks.
 * Not exhaustive — use `Intl.supportedValuesOf("timeZone")` when the full
 * list is needed.
 */
export const COMMON_TIME_ZONES: readonly string[] = [
  "UTC",
  "Europe/London",
  "Europe/Dublin",
  "Europe/Lisbon",
  "Europe/Madrid",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Rome",
  "Europe/Amsterdam",
  "Europe/Brussels",
  "Europe/Zurich",
  "Europe/Vienna",
  "Europe/Warsaw",
  "Europe/Prague",
  "Europe/Budapest",
  "Europe/Athens",
  "Europe/Istanbul",
  "Europe/Kyiv",
  "Europe/Moscow",
  "Africa/Cairo",
  "Africa/Johannesburg",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Bangkok",
  "Asia/Singapore",
  "Asia/Hong_Kong",
  "Asia/Shanghai",
  "Asia/Tokyo",
  "Australia/Perth",
  "Australia/Sydney",
  "Pacific/Auckland",
  "America/New_York",
  "America/Toronto",
  "America/Vancouver",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Mexico_City",
  "America/Sao_Paulo",
  "America/Buenos_Aires",
]

export interface DetectTimeZoneOptions {
  /**
   * Pre-resolved zone name (e.g. from a user preference). When `undefined`
   * the runtime's detected zone is used; invalid or missing values fall back
   * to UTC.
   */
  resolvedTimeZone?: string | null
}

/** True when `Intl` accepts `timeZone` as a valid IANA zone name. */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone })
    return true
  } catch {
    return false
  }
}

/**
 * Resolve the user's IANA time zone. Honors `options.resolvedTimeZone` first,
 * then `Intl.DateTimeFormat().resolvedOptions().timeZone`, and finally UTC.
 */
export function detectTimeZone(options: DetectTimeZoneOptions = {}): string {
  let candidate = options.resolvedTimeZone

  if (candidate === undefined) {
    try {
      candidate = Intl.DateTimeFormat().resolvedOptions().timeZone ?? null
    } catch {
      candidate = null
    }
  }

  if (typeof candidate === "string" && candidate.length > 0 && isValidTimeZone(candidate)) {
    return candidate
  }

  return FALLBACK_TIME_ZONE
}

/**
 * Offset of `timeZone` from UTC at `date`, in milliseconds (positive east of
 * Greenwich). Invalid zones are treated as UTC.
 */
export function getUtcOffsetMs(timeZone: string, date: Date = new Date()): number {
  const zone = isValidTimeZone(timeZone) ? timeZone : FALLBACK_TIME_ZONE
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date)

  const values: Partial<Record<Intl.DateTimeFormatPartTypes, string>> = {}
  for (const part of parts) {
    if (part.type !== "literal") values[part.type] = part.value
  }

  const wallClockAsUtc = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour) % 24,
    Number(values.minute),
    Number(values.second),
  )

  return wallClockAsUtc - Math.floor(date.getTime() / 1000) * 1000
}

/**
 * Human-readable UTC offset such as `UTC`, `UTC+3`, `UTC-5`, or `UTC+5:30`.
 */
export function formatUtcOffset(timeZone: string, date: Date = new Date()): string {
  const offsetMinutes = Math.round(getUtcOffsetMs(timeZone, date) / 60_000)
  if (offsetMinutes === 0) return "UTC"

  const sign = offsetMinutes < 0 ? "-" : "+"
  const absolute = Math.abs(offsetMinutes)
  const hours = Math.floor(absolute / 60)
  const minutes = absolute % 60

  return minutes === 0
    ? `UTC${sign}${hours}`
    : `UTC${sign}${hours}:${String(minutes).padStart(2, "0")}`
}

function formatter(timeZone: string, locale?: string) {
  const zone = isValidTimeZone(timeZone) ? timeZone : FALLBACK_TIME_ZONE
  return new Intl.DateTimeFormat(locale, {
    timeZone: zone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  })
}

/** `HH:MM` (24-hour) wall-clock time in `timeZone` for `date`. */
export function formatTimeInZone(date: Date, timeZone: string, locale?: string): string {
  return formatter(timeZone, locale).format(date)
}

/** Full date + time string in `timeZone`, suitable for `title`/tooltips. */
export function formatDateTimeInZone(date: Date, timeZone: string, locale?: string): string {
  const zone = isValidTimeZone(timeZone) ? timeZone : FALLBACK_TIME_ZONE
  return new Intl.DateTimeFormat(locale, {
    timeZone: zone,
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date)
}
