/**
 * Pure date logic for the DatePicker component.
 *
 * Everything in this module is framework-agnostic and side-effect free so it
 * can be unit-tested without rendering. The component owns React state; these
 * helpers own the math.
 */

/** Inclusive date range; either bound may be absent while picking. */
export interface DateRange {
  from?: Date
  to?: Date
}

/** A named range shortcut; `range` may be a value or a factory evaluated at click time. */
export interface DatePickerPreset {
  label: string
  range: DateRange | (() => DateRange)
}

/** Accepted picker values: single date, range, or empty. */
export type DatePickerValue = Date | DateRange | null | undefined

/** Labels used by default range presets and default UI copy. */
export interface DatePickerPresetLabels {
  today: string
  yesterday: string
  last7Days: string
  last30Days: string
  thisMonth: string
}

export const defaultPresetLabels: DatePickerPresetLabels = {
  today: "Today",
  yesterday: "Yesterday",
  last7Days: "Last 7 days",
  last30Days: "Last 30 days",
  thisMonth: "This month",
}

/** Constraints applied when a range selection is completed. */
export interface DateRangeConstraints {
  /** Minimum number of days between `from` and `to` (inclusive span - 1). */
  minRangeDays?: number
  /** Maximum number of days between `from` and `to` (inclusive span - 1). */
  maxRangeDays?: number
}

/** Visual state of a single calendar day cell. */
export type DayState =
  | "default"
  | "outside"
  | "today"
  | "selected"
  | "range-start"
  | "range-end"
  | "range-middle"
  | "range-preview"
  | "disabled"

const DAY_MS = 24 * 60 * 60 * 1000

/** Copy of `date` at local midnight (00:00:00.000). */
export function startOfDay(date: Date): Date {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d
}

/** `date` shifted by `days` calendar days, normalized to start of day. */
export function addDays(date: Date, days: number): Date {
  const d = startOfDay(date)
  d.setDate(d.getDate() + days)
  return d
}

/** `date` shifted by `months` months, clamped to the target month's last day. */
export function addMonths(date: Date, months: number): Date {
  const d = new Date(date)
  const day = d.getDate()
  d.setDate(1)
  d.setMonth(d.getMonth() + months)
  // Clamp to the last day of the target month (e.g. Jan 31 + 1 month -> Feb 28).
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
  d.setDate(Math.min(day, lastDay))
  return startOfDay(d)
}

/** First day of the month containing `date`, at start of day. */
export function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

/** Last day of the month containing `date`, at start of day. */
export function endOfMonth(date: Date): Date {
  const d = new Date(date.getFullYear(), date.getMonth() + 1, 0)
  return startOfDay(d)
}

/**
 * Start of the week containing `date`.
 * @param firstDayOfWeek 0 = Sunday (default) … 6 = Saturday.
 */
export function startOfWeek(date: Date, firstDayOfWeek = 0): Date {
  const d = startOfDay(date)
  const diff = (d.getDay() - firstDayOfWeek + 7) % 7
  d.setDate(d.getDate() - diff)
  return d
}

/** Last day of the week containing `date`, honoring `firstDayOfWeek`. */
export function endOfWeek(date: Date, firstDayOfWeek = 0): Date {
  return addDays(startOfWeek(date, firstDayOfWeek), 6)
}

/** True when `a` and `b` fall on the same calendar day. */
export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

/** True when `a`'s calendar day is strictly before `b`'s. */
export function isBeforeDay(a: Date, b: Date): boolean {
  return startOfDay(a).getTime() < startOfDay(b).getTime()
}

/** True when `a`'s calendar day is strictly after `b`'s. */
export function isAfterDay(a: Date, b: Date): boolean {
  return startOfDay(a).getTime() > startOfDay(b).getTime()
}

/** Whole days between two dates (b - a), ignoring time-of-day. */
export function diffDays(a: Date, b: Date): number {
  return Math.round((startOfDay(b).getTime() - startOfDay(a).getTime()) / DAY_MS)
}

/** Stable "Y-M-D" key for `date`'s calendar day (local time). */
export function dayKey(date: Date): string {
  const d = startOfDay(date)
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

/** DOM id for a calendar day cell, e.g. "dp-day-2026-01-05". */
export function dateId(date: Date): string {
  const d = startOfDay(date)
  return `dp-day-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

/** Coerce any picker value into a `DateRange` (`{}` when empty). */
export function asRange(value: DatePickerValue): DateRange {
  if (!value) return {}
  if (value instanceof Date) return { from: value }
  return value
}

/** Coerce any picker value into a single `Date` (`to` preferred over `from`). */
export function asSingle(value: DatePickerValue): Date | undefined {
  if (!value) return undefined
  if (value instanceof Date) return value
  return value.to ?? value.from
}

/** Ensure `from <= to`, swapping when the caller supplied them reversed. */
export function normalizeRange(range: DateRange): DateRange {
  const { from, to } = range
  if (from && to && isBeforeDay(to, from)) {
    return { from: startOfDay(to), to: startOfDay(from) }
  }
  return {
    from: from ? startOfDay(from) : undefined,
    to: to ? startOfDay(to) : undefined,
  }
}

/**
 * Result of clicking a day while picking a range.
 * - No `from` yet, or a complete range exists -> start a new range.
 * - `from` exists without `to` -> complete it (swapping when clicked before).
 */
export function resolveRangeClick(current: DateRange | undefined, day: Date): DateRange {
  const picked = startOfDay(day)
  if (!current?.from || current.to) {
    return { from: picked, to: undefined }
  }
  const from = startOfDay(current.from)
  if (isBeforeDay(picked, from)) {
    return { from: picked, to: from }
  }
  return { from, to: picked }
}

/** Inclusive containment check for a single day inside a range. */
export function isDayInRange(day: Date, range: DateRange): boolean {
  const { from, to } = normalizeRange(range)
  if (!from) return false
  if (!to) return isSameDay(day, from)
  return !isBeforeDay(day, from) && !isAfterDay(day, to)
}

/** Span of a completed range in days (`to - from`); undefined when incomplete. */
export function rangeSpanDays(range: DateRange): number | undefined {
  const { from, to } = normalizeRange(range)
  if (!from || !to) return undefined
  return diffDays(from, to)
}

/** True when the range's span satisfies `minRangeDays`/`maxRangeDays` (or is incomplete). */
export function isRangeWithinConstraints(
  range: DateRange,
  constraints: DateRangeConstraints,
): boolean {
  const span = rangeSpanDays(range)
  if (span === undefined) return true
  if (constraints.minRangeDays !== undefined && span < constraints.minRangeDays) {
    return false
  }
  if (constraints.maxRangeDays !== undefined && span > constraints.maxRangeDays) {
    return false
  }
  return true
}

/**
 * 42 days (6 rows x 7) covering the month that contains `viewMonth`,
 * starting on `firstDayOfWeek`.
 */
export function getCalendarDays(viewMonth: Date, firstDayOfWeek = 0): Date[] {
  const first = startOfWeek(startOfMonth(viewMonth), firstDayOfWeek)
  return Array.from({ length: 42 }, (_, i) => addDays(first, i))
}

/** The 42 calendar days grouped into 6 weeks of 7, for grid rendering. */
export function getCalendarWeeks(viewMonth: Date, firstDayOfWeek = 0): Date[][] {
  const days = getCalendarDays(viewMonth, firstDayOfWeek)
  const rows: Date[][] = []
  for (let i = 0; i < 42; i += 7) rows.push(days.slice(i, i + 7))
  return rows
}

/**
 * Weekday header labels starting at `firstDayOfWeek`.
 * Uses a known Sunday (2024-01-07) as the reference date.
 */
export function getWeekdayLabels(locale: string | undefined, firstDayOfWeek = 0): string[] {
  const sunday = new Date(2024, 0, 7)
  return Array.from({ length: 7 }, (_, i) =>
    new Intl.DateTimeFormat(locale, { weekday: "short" }).format(
      addDays(sunday, firstDayOfWeek + i),
    ),
  )
}

/** Evaluate a preset's range, calling it when `range` is a factory function. */
export function resolvePreset(preset: DatePickerPreset): DateRange {
  return typeof preset.range === "function" ? preset.range() : preset.range
}

/** Build the default range presets (today, yesterday, last 7/30 days, this month). */
export function buildDefaultPresets(
  labels: DatePickerPresetLabels = defaultPresetLabels,
): DatePickerPreset[] {
  const today = startOfDay(new Date())
  return [
    {
      label: labels.today,
      range: () => ({ from: today, to: today }),
    },
    {
      label: labels.yesterday,
      range: () => {
        const d = addDays(today, -1)
        return { from: d, to: d }
      },
    },
    {
      label: labels.last7Days,
      range: () => ({ from: addDays(today, -6), to: today }),
    },
    {
      label: labels.last30Days,
      range: () => ({ from: addDays(today, -29), to: today }),
    },
    {
      label: labels.thisMonth,
      range: () => ({ from: startOfMonth(today), to: endOfMonth(today) }),
    },
  ]
}

/* ------------------------------------------------------------------------ */
/* Keyboard navigation                                                       */
/* ------------------------------------------------------------------------ */

export interface CalendarNavState {
  activeDate: Date
  viewMonth: Date
}

export interface CalendarNavOptions {
  /** Flip ArrowLeft/ArrowRight for RTL layouts. */
  rtl?: boolean
  firstDayOfWeek?: number
  shiftKey?: boolean
  /** Days that cannot receive focus (disabled / out of bounds). */
  isDisabled?: (date: Date) => boolean
}

function stepToEnabled(
  date: Date,
  dir: 1 | -1,
  isDisabled: ((d: Date) => boolean) | undefined,
  maxSteps = 62,
): Date {
  if (!isDisabled || !isDisabled(date)) return startOfDay(date)
  let next = startOfDay(date)
  for (let i = 0; i < maxSteps; i++) {
    next = addDays(next, dir)
    if (!isDisabled(next)) return next
  }
  // Fall back to scanning the opposite direction.
  next = startOfDay(date)
  for (let i = 0; i < maxSteps; i++) {
    next = addDays(next, dir === 1 ? -1 : 1)
    if (!isDisabled(next)) return next
  }
  return startOfDay(date)
}

/**
 * Move `days` calendar days from `from`, then keep stepping in the same
 * direction until an enabled day is found (bounded).
 */
function moveByDays(
  from: Date,
  days: number,
  isDisabled: ((d: Date) => boolean) | undefined,
): Date {
  const dir: 1 | -1 = days >= 0 ? 1 : -1
  let remaining = Math.abs(days)
  let next = startOfDay(from)
  for (let i = 0; i < 400; i++) {
    next = addDays(next, dir)
    if (remaining > 0) remaining--
    if (remaining === 0 && (!isDisabled || !isDisabled(next))) break
  }
  return next
}

function syncViewMonth(state: CalendarNavState, activeDate: Date): CalendarNavState {
  const month = startOfMonth(activeDate)
  const same =
    month.getFullYear() === state.viewMonth.getFullYear() &&
    month.getMonth() === state.viewMonth.getMonth()
  return { activeDate: startOfDay(activeDate), viewMonth: same ? state.viewMonth : month }
}

/**
 * Compute the next keyboard-nav state for a handled key.
 * Returns `null` for keys the calendar does not handle.
 */
export function navigateCalendar(
  state: CalendarNavState,
  key: string,
  options: CalendarNavOptions = {},
): CalendarNavState | null {
  const { rtl = false, firstDayOfWeek = 0, shiftKey = false, isDisabled } = options
  const { activeDate } = state

  switch (key) {
    case "ArrowLeft":
    case "ArrowRight": {
      const forward = key === "ArrowRight"
      // In RTL the visual direction is mirrored: ArrowLeft moves forward in time.
      const delta = (rtl ? !forward : forward) ? 1 : -1
      return syncViewMonth(state, moveByDays(activeDate, delta, isDisabled))
    }
    case "ArrowUp":
      return syncViewMonth(state, moveByDays(activeDate, -7, isDisabled))
    case "ArrowDown":
      return syncViewMonth(state, moveByDays(activeDate, 7, isDisabled))
    case "PageUp": {
      const months = shiftKey ? -12 : -1
      const next = stepToEnabled(addMonths(activeDate, months), months < 0 ? -1 : 1, isDisabled)
      return syncViewMonth(state, next)
    }
    case "PageDown": {
      const months = shiftKey ? 12 : 1
      const next = stepToEnabled(addMonths(activeDate, months), 1, isDisabled)
      return syncViewMonth(state, next)
    }
    case "Home": {
      const weekStart = startOfWeek(activeDate, firstDayOfWeek)
      return syncViewMonth(state, stepToEnabled(weekStart, 1, isDisabled))
    }
    case "End": {
      const weekEnd = endOfWeek(activeDate, firstDayOfWeek)
      return syncViewMonth(state, stepToEnabled(weekEnd, -1, isDisabled))
    }
    default:
      return null
  }
}

/* ------------------------------------------------------------------------ */
/* Type-ahead                                                                */
/* ------------------------------------------------------------------------ */

/**
 * Does `buffer` match this day? Matches either the day-of-month digits
 * ("15") or a prefix of any candidate label (weekday "sun", month "jun").
 */
export function matchesTypeAhead(
  buffer: string,
  day: Date,
  candidates: string | string[],
): boolean {
  const b = buffer.trim().toLowerCase()
  if (!b) return false
  if (String(day.getDate()) === b) return true
  const list = Array.isArray(candidates) ? candidates : [candidates]
  return list.some((label) => label.toLowerCase().startsWith(b))
}

/**
 * Find the next day matching `buffer`, scanning `days` cyclically starting
 * after `startIndex`. `candidatesPerDay[i]` holds the matchable labels for
 * `days[i]` (see `matchesTypeAhead`). Returns the index into `days`, or -1.
 */
export function findTypeAheadIndex(
  buffer: string,
  days: Date[],
  candidatesPerDay: (string | string[])[],
  startIndex: number,
): number {
  if (!buffer || days.length === 0) return -1
  for (let i = 1; i <= days.length; i++) {
    const idx = (startIndex + i) % days.length
    if (matchesTypeAhead(buffer, days[idx], candidatesPerDay[idx] ?? "")) return idx
  }
  return -1
}

/* ------------------------------------------------------------------------ */
/* Editable range inputs                                                     */
/* ------------------------------------------------------------------------ */

/**
 * Tolerant date parser for the editable start/end inputs.
 * Accepts ISO `YYYY-MM-DD` plus anything `Date.parse` understands
 * (e.g. "Jun 10, 2025"). Returns start-of-day or undefined.
 */
export function parseDateInput(raw: string): Date | undefined {
  const s = raw.trim()
  if (!s) return undefined
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s)
  let d: Date
  if (iso) {
    d = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]))
  } else {
    const t = Date.parse(s)
    if (Number.isNaN(t)) return undefined
    d = new Date(t)
  }
  if (Number.isNaN(d.getTime())) return undefined
  return startOfDay(d)
}
