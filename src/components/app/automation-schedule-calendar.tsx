"use client"

import { useEffect, useMemo, useState } from "react"
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react"

import {
  describeSchedule,
  isScheduleValid,
  nextScheduleRuns,
  type AutomationSchedule,
} from "@/lib/automations/schedule"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"

import { formatDateTime } from "./format"

/**
 * Month-grid calendar showing when scheduled automations will run. Entries are
 * resolved by the panel (schedule + last-run anchor); event/webhook triggers
 * carry `schedule: null` and are reported separately since they have no
 * predictable run times.
 */

export interface ScheduleCalendarEntry {
  id: string
  name: string
  enabled: boolean
  triggerKind: "schedule" | "event" | "webhook"
  /** Resolved schedule; null for event/webhook triggers or invalid cron. */
  schedule: AutomationSchedule | null
  /** Last run time — anchors interval schedules. */
  lastRunAt: string | null
  /** Short trigger description shown under the automation name. */
  detail: string
}

interface CalendarOccurrence {
  entry: ScheduleCalendarEntry
  at: Date
}

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
]

/** Monday-first weekday headers, matching the builder's day pills. */
const WEEKDAY_HEADERS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

/** Safety cap so dense schedules (e.g. every minute) can't loop forever. */
const MAX_OCCURRENCES_PER_ENTRY = 500
const MAX_DAY_CHIPS = 2
const UPCOMING_LIMIT = 12
const UPCOMING_PER_ENTRY = 3

function pad2(value: number) {
  return String(value).padStart(2, "0")
}

/** Local-time day key, e.g. "2026-11-19". */
function dayKey(date: Date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

function clockLabel(date: Date) {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`
}

function sameDay(a: Date, b: Date) {
  return dayKey(a) === dayKey(b)
}

function entryAnchor(entry: ScheduleCalendarEntry): Date | null {
  if (!entry.lastRunAt) return null
  const parsed = new Date(entry.lastRunAt)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function entryHasSchedule(
  entry: ScheduleCalendarEntry,
): entry is ScheduleCalendarEntry & { schedule: AutomationSchedule } {
  return entry.enabled && entry.schedule !== null && isScheduleValid(entry.schedule)
}

/**
 * All occurrences of every scheduled entry inside the given month, keyed by
 * local day. Interval schedules stay anchored to each entry's last run.
 */
function occurrencesByDay(
  entries: ScheduleCalendarEntry[],
  year: number,
  monthIndex: number,
): Map<string, CalendarOccurrence[]> {
  const byDay = new Map<string, CalendarOccurrence[]>()
  const monthStart = new Date(year, monthIndex, 1)
  const monthEnd = new Date(year, monthIndex + 1, 1)

  for (const entry of entries) {
    if (!entryHasSchedule(entry)) continue
    const anchor = entryAnchor(entry)
    // Start one ms before the month so the first in-month run is included.
    let cursor = new Date(monthStart.getTime() - 1)

    for (let i = 0; i < MAX_OCCURRENCES_PER_ENTRY; i += 1) {
      const [next] = nextScheduleRuns(entry.schedule, 1, cursor, anchor)
      if (!next || next >= monthEnd) break
      if (next >= monthStart) {
        const key = dayKey(next)
        const list = byDay.get(key) ?? []
        list.push({ entry, at: next })
        byDay.set(key, list)
      }
      cursor = next
    }
  }

  for (const list of byDay.values()) {
    list.sort((a, b) => a.at.getTime() - b.at.getTime())
  }
  return byDay
}

/** Next few runs per scheduled entry, flattened and sorted soonest-first. */
function upcomingOccurrences(entries: ScheduleCalendarEntry[]): CalendarOccurrence[] {
  const now = new Date()
  const runs: CalendarOccurrence[] = []
  for (const entry of entries) {
    if (!entryHasSchedule(entry)) continue
    for (const at of nextScheduleRuns(
      entry.schedule,
      UPCOMING_PER_ENTRY,
      now,
      entryAnchor(entry),
    )) {
      runs.push({ entry, at })
    }
  }
  runs.sort((a, b) => a.at.getTime() - b.at.getTime())
  return runs.slice(0, UPCOMING_LIMIT)
}

export function AutomationScheduleCalendar({
  open,
  onOpenChange,
  entries,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  entries: ScheduleCalendarEntry[]
}) {
  const [viewDate, setViewDate] = useState(() => new Date())

  // Always open on the current month.
  useEffect(() => {
    if (open) setViewDate(new Date())
  }, [open])

  const year = viewDate.getFullYear()
  const monthIndex = viewDate.getMonth()

  const byDay = useMemo(
    () => occurrencesByDay(entries, year, monthIndex),
    [entries, year, monthIndex],
  )
  const upcoming = useMemo(() => upcomingOccurrences(entries), [entries])

  const scheduledCount = entries.filter(entryHasSchedule).length
  const unscheduledCount = entries.filter(
    (entry) => entry.enabled && entry.triggerKind !== "schedule",
  ).length
  const pausedCount = entries.filter(
    (entry) =>
      !entry.enabled && entry.schedule !== null && isScheduleValid(entry.schedule),
  ).length

  // Monday-first grid: pad the front so day 1 lands under the right weekday.
  const firstWeekday = (new Date(year, monthIndex, 1).getDay() + 6) % 7
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate()
  const cells: (Date | null)[] = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => new Date(year, monthIndex, i + 1)),
  ]
  while (cells.length % 7 !== 0) cells.push(null)

  const today = new Date()

  function shiftMonth(delta: number) {
    setViewDate(new Date(year, monthIndex + delta, 1))
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            <span className="inline-flex items-center gap-2">
              <CalendarDays className="size-4" aria-hidden="true" />
              Automation schedule
            </span>
          </DialogTitle>
          <DialogDescription>
            When each enabled automation is next due. Event- and webhook-driven automations run on
            demand and don&apos;t appear here.
          </DialogDescription>
        </DialogHeader>

        <div className="app-automation-schedule-calendar">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">
              {MONTH_NAMES[monthIndex]} {year}
            </h3>
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-label="Previous month"
                onClick={() => shiftMonth(-1)}
              >
                <ChevronLeft aria-hidden="true" />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-label="Next month"
                onClick={() => shiftMonth(1)}
              >
                <ChevronRight aria-hidden="true" />
              </Button>
            </div>
          </div>

          <div
            className="grid grid-cols-7 gap-1"
            role="grid"
            aria-label={`${MONTH_NAMES[monthIndex]} ${year} automation schedule`}
          >
            {WEEKDAY_HEADERS.map((label) => (
              <div
                key={label}
                className="text-muted-foreground px-1 pb-1 text-center text-[10px] font-semibold tracking-wide uppercase"
              >
                {label}
              </div>
            ))}
            {cells.map((day, index) => {
              if (!day) {
                return <div key={`pad-${index}`} className="min-h-16" aria-hidden="true" />
              }
              const occurrences = byDay.get(dayKey(day)) ?? []
              const isToday = sameDay(day, today)
              return (
                <div
                  key={dayKey(day)}
                  role="gridcell"
                  aria-label={`${formatDateTime(day.toISOString())}${
                    occurrences.length > 0
                      ? `, ${occurrences.length} scheduled run${occurrences.length === 1 ? "" : "s"}`
                      : ""
                  }`}
                  className={cn(
                    "flex min-h-16 flex-col gap-0.5 rounded-md border p-1.5",
                    isToday ? "border-[var(--app-accent)]" : "border-border",
                    occurrences.length > 0 && "bg-[var(--app-accent-soft)]",
                  )}
                >
                  <span
                    className={cn(
                      "text-[11px] font-medium",
                      isToday ? "text-[var(--app-accent)]" : "text-foreground",
                    )}
                  >
                    {day.getDate()}
                  </span>
                  {occurrences.slice(0, MAX_DAY_CHIPS).map((occurrence) => (
                    <span
                      key={`${occurrence.entry.id}-${occurrence.at.toISOString()}`}
                      className="truncate rounded-sm bg-[var(--app-accent-soft)] px-1 text-[9px] leading-4 text-[var(--app-accent)]"
                      title={`${occurrence.entry.name} · ${formatDateTime(occurrence.at.toISOString())}`}
                    >
                      {clockLabel(occurrence.at)} {occurrence.entry.name}
                    </span>
                  ))}
                  {occurrences.length > MAX_DAY_CHIPS ? (
                    <span className="text-muted-foreground px-1 text-[9px]">
                      +{occurrences.length - MAX_DAY_CHIPS} more
                    </span>
                  ) : null}
                </div>
              )
            })}
          </div>

          <div className="grid gap-1">
            <h4 className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
              Upcoming runs
            </h4>
            {upcoming.length === 0 ? (
              <p className="text-muted-foreground text-xs">
                {scheduledCount === 0
                  ? "No scheduled automations to show."
                  : "Nothing scheduled in the near term."}
              </p>
            ) : (
              <ul className="grid max-h-44 gap-1 overflow-y-auto">
                {upcoming.map((occurrence) => (
                  <li
                    key={`${occurrence.entry.id}-${occurrence.at.toISOString()}`}
                    className="border-border/60 flex items-center gap-2 rounded border px-2 py-1 text-xs"
                  >
                    <span className="min-w-0 flex-1 truncate font-medium">
                      {occurrence.entry.name}
                    </span>
                    <span className="text-muted-foreground shrink-0">
                      {describeSchedule(occurrence.entry.schedule as AutomationSchedule)}
                    </span>
                    <time
                      dateTime={occurrence.at.toISOString()}
                      className="text-muted-foreground shrink-0"
                    >
                      {formatDateTime(occurrence.at.toISOString())}
                    </time>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <p className="text-muted-foreground text-[11px]">
            {scheduledCount} scheduled · {pausedCount} paused · {unscheduledCount} event-driven
          </p>
        </div>
      </DialogContent>
    </Dialog>
  )
}
