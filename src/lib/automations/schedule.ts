/**
 * Schedule model for workspace automations. A schedule is either a five-field
 * cron expression (handled by `./cron`) or a fixed interval ("every N
 * minutes/hours/days"). The panel stores the resolved schedule on the
 * automation record so the table, the studio dialog, and run-now all agree on
 * when the next execution is due.
 */

import { humanizeCron, nextCronRuns } from "./cron"

export type ScheduleIntervalUnit = "minutes" | "hours" | "days"

export type AutomationSchedule =
  { kind: "cron"; expr: string } | { kind: "interval"; every: number; unit: ScheduleIntervalUnit }

export type IntervalSchedule = Extract<AutomationSchedule, { kind: "interval" }>

export const INTERVAL_UNITS: ReadonlyArray<{ value: ScheduleIntervalUnit; label: string }> = [
  { value: "minutes", label: "minutes" },
  { value: "hours", label: "hours" },
  { value: "days", label: "days" },
]

/** Reasonable upper bounds so interval schedules stay meaningful. */
const MAX_INTERVAL: Record<ScheduleIntervalUnit, number> = {
  minutes: 1440, // once a day at most
  hours: 168, // once a week at most
  days: 366, // roughly yearly
}

const UNIT_MS: Record<ScheduleIntervalUnit, number> = {
  minutes: 60_000,
  hours: 3_600_000,
  days: 86_400_000,
}

/** Validate an interval schedule; returns a human error or null when valid. */
export function intervalError(schedule: {
  every: number
  unit: ScheduleIntervalUnit
}): string | null {
  if (!Number.isInteger(schedule.every) || schedule.every < 1) {
    return "Repeat every must be a whole number of at least 1."
  }
  const max = MAX_INTERVAL[schedule.unit]
  if (schedule.every > max) {
    return `Repeat every can't exceed ${max} ${schedule.unit}.`
  }
  return null
}

/** Plain-English description of any schedule, for table cells and hints. */
export function describeSchedule(schedule: AutomationSchedule): string {
  if (schedule.kind === "cron") {
    const human = humanizeCron(schedule.expr)
    return human.valid ? human.text : "Invalid cron expression"
  }
  const unit = schedule.unit
  const label = schedule.every === 1 ? unit.replace(/s$/, "") : unit
  return `Every ${schedule.every} ${label}`
}

/** True when the schedule can produce run times. */
export function isScheduleValid(schedule: AutomationSchedule): boolean {
  if (schedule.kind === "cron") return humanizeCron(schedule.expr).valid
  return intervalError(schedule) === null
}

/**
 * Compute the next `count` run times for a schedule.
 *
 * Cron schedules are wall-clock expressions and ignore `anchor`. Interval
 * schedules count from `anchor` (typically the last run time) when one is
 * provided, so "every 30 minutes" stays aligned to real executions instead of
 * drifting from page load; without an anchor the interval counts from `from`.
 */
export function nextScheduleRuns(
  schedule: AutomationSchedule,
  count = 1,
  from = new Date(),
  anchor?: Date | null,
): Date[] {
  if (!isScheduleValid(schedule)) return []

  if (schedule.kind === "cron") {
    return nextCronRuns(schedule.expr, count, from)
  }

  const stepMs = UNIT_MS[schedule.unit] * schedule.every
  const base = anchor && anchor.getTime() < from.getTime() ? anchor : from
  const elapsed = Math.max(0, from.getTime() - base.getTime())
  // First occurrence strictly after `from`.
  const first = new Date(base.getTime() + (Math.floor(elapsed / stepMs) + 1) * stepMs)

  const runs: Date[] = []
  for (let i = 0; i < count; i++) {
    runs.push(new Date(first.getTime() + i * stepMs))
  }
  return runs
}

/** Build an interval schedule, returning null when the input is unusable. */
export function makeIntervalSchedule(
  every: number,
  unit: ScheduleIntervalUnit,
): IntervalSchedule | null {
  const schedule: IntervalSchedule = { kind: "interval", every, unit }
  return intervalError(schedule) === null ? schedule : null
}
