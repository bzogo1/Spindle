"use client"

import * as React from "react"
import { cva } from "class-variance-authority"
import { cn } from "@/lib/utils"
import { CalendarDaysIcon, ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon } from "lucide-react"
import { Popover as PopoverPrimitive } from "radix-ui"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  addMonths,
  asRange,
  asSingle,
  buildDefaultPresets,
  dateId,
  dayKey,
  defaultPresetLabels,
  findTypeAheadIndex,
  getCalendarWeeks,
  getWeekdayLabels,
  isAfterDay,
  isBeforeDay,
  isDayInRange,
  isRangeWithinConstraints,
  isSameDay,
  navigateCalendar,
  normalizeRange,
  parseDateInput,
  resolvePreset,
  resolveRangeClick,
  startOfDay,
  startOfMonth,
  type DatePickerPreset,
  type DatePickerPresetLabels,
  type DatePickerValue,
  type DateRange,
  type DateRangeConstraints,
} from "@/lib/date-picker-utils"

export type {
  DatePickerPreset,
  DatePickerPresetLabels,
  DatePickerValue,
  DateRange,
  DateRangeConstraints,
}

/** Full set of user-facing strings; every key has an English default. */
export interface DatePickerLabels extends DatePickerPresetLabels {
  /** Trigger placeholder in single mode. */
  placeholder: string
  /** Trigger placeholder in range mode. */
  rangePlaceholder: string
  /** aria-label for the day grid in single mode. */
  chooseDate: string
  /** aria-label for the day grid in range mode. */
  chooseDateRange: string
  /** aria-label for the month <select>. */
  month: string
  /** aria-label for the year <select>. */
  year: string
  previousMonth: string
  nextMonth: string
  /** aria-label for the presets sidebar. */
  presetsLabel: string
  /** Label/aria-label for the editable range start input. */
  startDate: string
  /** Label/aria-label for the editable range end input. */
  endDate: string
  /** Error shown when a range violates min/max constraints or fails to parse. */
  invalidRange: string
}

export const defaultDatePickerLabels: DatePickerLabels = {
  ...defaultPresetLabels,
  placeholder: "Pick a date",
  rangePlaceholder: "Pick a date range",
  chooseDate: "Choose date",
  chooseDateRange: "Choose date range",
  month: "Month",
  year: "Year",
  previousMonth: "Previous month",
  nextMonth: "Next month",
  presetsLabel: "Date range presets",
  startDate: "Start date",
  endDate: "End date",
  invalidRange: "Invalid date range",
}

export interface DatePickerProps {
  mode?: "single" | "range"
  value?: DatePickerValue
  defaultValue?: DatePickerValue
  onChange?: (value: Date | DateRange) => void
  /** Custom presets. Defaults to the built-in range presets in "range" mode; pass [] to hide. */
  presets?: DatePickerPreset[]
  minDate?: Date
  maxDate?: Date
  /** Minimum/maximum span (in days between `from` and `to`) for a completed range. */
  minRangeDays?: number
  maxRangeDays?: number
  disabled?: boolean
  /** Array of disabled days, a predicate, or a mix via `disabledRanges`. Combined with minDate/maxDate. */
  disabledDates?: Date[] | ((date: Date) => boolean)
  /** Ranges whose days are all disabled (e.g. weekends, blackout periods). */
  disabledRanges?: DateRange[]
  /** BCP-47 locale for month/weekday/date formatting. Defaults to the runtime locale. */
  locale?: string
  /** First day of the week: 0 = Sunday … 6 = Saturday. Defaults to 0. */
  firstDayOfWeek?: 0 | 1 | 2 | 3 | 4 | 5 | 6
  /** Text direction. "auto" (default) detects from the document; "rtl" flips arrow keys and mirrors layout. */
  dir?: "ltr" | "rtl" | "auto"
  /** Partial override of all user-facing labels (presets + UI copy). */
  labels?: Partial<DatePickerLabels>
  placeholder?: string
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  align?: "start" | "center" | "end"
  side?: "top" | "right" | "bottom" | "left"
  sideOffset?: number
  className?: string
  triggerClassName?: string
  contentClassName?: string
  calendarClassName?: string
  id?: string
  name?: string
}

const dayButtonVariants = cva(
  "relative flex size-8 cursor-pointer items-center justify-center rounded-md text-sm font-normal transition-colors outline-none select-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-40 aria-disabled:opacity-40 aria-disabled:line-through",
  {
    variants: {
      state: {
        default: "text-foreground",
        outside: "text-muted-foreground/60",
        today: "font-semibold ring-1 ring-inset ring-border",
        selected:
          "bg-primary font-medium text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground",
        "range-start":
          "rounded-e-none bg-primary font-medium text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground",
        "range-end":
          "rounded-s-none bg-primary font-medium text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground",
        "range-middle":
          "rounded-none bg-accent text-accent-foreground hover:bg-accent hover:text-accent-foreground",
        "range-preview":
          "rounded-none bg-accent/60 text-accent-foreground hover:bg-accent/80 hover:text-accent-foreground",
        disabled: "text-muted-foreground opacity-40 hover:bg-transparent",
      },
    },
    defaultVariants: {
      state: "default",
    },
  },
)

type DayState =
  | "default"
  | "outside"
  | "today"
  | "selected"
  | "range-start"
  | "range-end"
  | "range-middle"
  | "range-preview"
  | "disabled"

const TYPE_AHEAD_TIMEOUT = 500

function resolveDirection(dir: DatePickerProps["dir"]): "ltr" | "rtl" {
  if (dir === "ltr" || dir === "rtl") return dir
  if (typeof document === "undefined") return "ltr"
  const rootDir =
    document.documentElement.dir ||
    document.body?.dir ||
    getComputedStyle(document.documentElement).direction
  return rootDir === "rtl" ? "rtl" : "ltr"
}

function DatePicker({
  mode = "single",
  value: controlledValue,
  defaultValue,
  onChange,
  presets,
  minDate,
  maxDate,
  minRangeDays,
  maxRangeDays,
  disabled = false,
  disabledDates,
  disabledRanges,
  locale,
  firstDayOfWeek = 0,
  dir = "auto",
  labels: labelsProp,
  placeholder,
  open: controlledOpen,
  defaultOpen = false,
  onOpenChange,
  align = "start",
  side = "bottom",
  sideOffset = 4,
  className,
  triggerClassName,
  contentClassName,
  calendarClassName,
  id,
  name,
}: DatePickerProps) {
  const labels = React.useMemo<DatePickerLabels>(
    () => ({ ...defaultDatePickerLabels, ...labelsProp }),
    [labelsProp],
  )

  const isRange = mode === "range"
  const [internalValue, setInternalValue] = React.useState<DatePickerValue>(defaultValue ?? null)
  const value = controlledValue !== undefined ? controlledValue : internalValue

  const [internalOpen, setInternalOpen] = React.useState(defaultOpen)
  const open = controlledOpen !== undefined ? controlledOpen : internalOpen

  const today = React.useMemo(() => startOfDay(new Date()), [])

  const initialFocus = React.useMemo(() => {
    const single = asSingle(value)
    const range = asRange(value)
    return single ?? range.to ?? range.from ?? today
  }, [value, today])

  const [viewMonth, setViewMonth] = React.useState<Date>(() => startOfMonth(initialFocus))
  const [activeDate, setActiveDate] = React.useState<Date>(() => startOfDay(initialFocus))
  // Hovered day while a range `from` is picked but `to` is not — drives the preview band.
  const [hoverDate, setHoverDate] = React.useState<Date | null>(null)
  // Set when a completed range violates minRangeDays/maxRangeDays.
  const [rangeError, setRangeError] = React.useState(false)

  const gridRef = React.useRef<HTMLDivElement>(null)
  const typeBufferRef = React.useRef("")
  const typeTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  React.useEffect(
    () => () => {
      if (typeTimerRef.current) clearTimeout(typeTimerRef.current)
    },
    [],
  )

  // Editable start/end inputs (range mode only).
  const [fromText, setFromText] = React.useState("")
  const [toText, setToText] = React.useState("")
  const [inputInvalid, setInputInvalid] = React.useState<"from" | "to" | null>(null)
  const [inputError, setInputError] = React.useState(false)

  const direction = React.useMemo(() => resolveDirection(dir), [dir, open])
  const isRtl = direction === "rtl"

  const formatters = React.useMemo(
    () => ({
      day: new Intl.DateTimeFormat(locale, {
        weekday: "short",
        month: "short",
        day: "numeric",
        year: "numeric",
      }),
      month: new Intl.DateTimeFormat(locale, { month: "long" }),
      short: new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" }),
      long: new Intl.DateTimeFormat(locale, {
        month: "short",
        day: "numeric",
        year: "numeric",
      }),
    }),
    [locale],
  )

  const formatDayLabel = React.useCallback(
    (date: Date) => formatters.day.format(date),
    [formatters],
  )

  const formatTriggerDate = React.useCallback(
    (date: Date, withYear = true) => (withYear ? formatters.long : formatters.short).format(date),
    [formatters],
  )

  const setOpen = React.useCallback(
    (next: boolean) => {
      if (controlledOpen === undefined) setInternalOpen(next)
      onOpenChange?.(next)
    },
    [controlledOpen, onOpenChange],
  )

  // Reset the calendar to the selected value each time the popover opens.
  React.useEffect(() => {
    if (open) {
      setViewMonth(startOfMonth(initialFocus))
      setActiveDate(startOfDay(initialFocus))
      setHoverDate(null)
      setRangeError(false)
    }
  }, [open, initialFocus])

  const disabledSet = React.useMemo(() => {
    if (Array.isArray(disabledDates)) {
      return new Set(disabledDates.map((d) => dayKey(d)))
    }
    return null
  }, [disabledDates])

  const normalizedDisabledRanges = React.useMemo(
    () => (disabledRanges ?? []).map((r) => normalizeRange(r)),
    [disabledRanges],
  )

  const isDayDisabled = React.useCallback(
    (date: Date): boolean => {
      const day = startOfDay(date)
      if (minDate && isBeforeDay(day, minDate)) return true
      if (maxDate && isAfterDay(day, maxDate)) return true
      if (typeof disabledDates === "function") return disabledDates(day)
      if (disabledSet) return disabledSet.has(dayKey(day))
      for (const range of normalizedDisabledRanges) {
        if (isDayInRange(day, range)) return true
      }
      return false
    },
    [minDate, maxDate, disabledDates, disabledSet, normalizedDisabledRanges],
  )

  const emitChange = React.useCallback(
    (next: Date | DateRange) => {
      if (controlledValue === undefined) setInternalValue(next)
      onChange?.(next)
    },
    [controlledValue, onChange],
  )

  const constraints: DateRangeConstraints = React.useMemo(
    () => ({ minRangeDays, maxRangeDays }),
    [minRangeDays, maxRangeDays],
  )

  const selectDate = React.useCallback(
    (day: Date) => {
      if (disabled || isDayDisabled(day)) return
      if (!isRange) {
        emitChange(startOfDay(day))
        setOpen(false)
        return
      }
      const next = resolveRangeClick(asRange(value), day)
      if (!next.to) {
        // First click of a new range: clear any stale error state.
        setRangeError(false)
        setInputError(false)
        setInputInvalid(null)
        emitChange(next)
        return
      }
      const normalized = normalizeRange(next)
      if (!isRangeWithinConstraints(normalized, constraints)) {
        // Invalid range: keep the in-progress `from`, stay open, flag the error.
        setRangeError(true)
        setInputError(true)
        emitChange({ from: normalized.from, to: undefined })
        return
      }
      setRangeError(false)
      setInputError(false)
      setInputInvalid(null)
      emitChange(normalized)
      setHoverDate(null)
      setOpen(false)
    },
    [disabled, isDayDisabled, isRange, value, emitChange, setOpen, constraints],
  )

  const selectPreset = React.useCallback(
    (preset: DatePickerPreset) => {
      const range = resolvePreset(preset)
      if (isRange) {
        emitChange(normalizeRange(range))
      } else {
        const single = range.to ?? range.from
        if (single) emitChange(startOfDay(single))
      }
      setRangeError(false)
      setInputError(false)
      setInputInvalid(null)
      setHoverDate(null)
      setOpen(false)
    },
    [isRange, emitChange, setOpen],
  )

  const weekDays = React.useMemo(
    () => getWeekdayLabels(locale, firstDayOfWeek),
    [locale, firstDayOfWeek],
  )

  const weeks = React.useMemo(
    () => getCalendarWeeks(viewMonth, firstDayOfWeek),
    [viewMonth, firstDayOfWeek],
  )

  // Keyboard navigation on the grid (roving active descendant).
  const handleGridKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (disabled) return

      const nav = navigateCalendar({ activeDate, viewMonth }, event.key, {
        rtl: isRtl,
        firstDayOfWeek,
        shiftKey: event.shiftKey,
        isDisabled: isDayDisabled,
      })
      if (nav) {
        event.preventDefault()
        setActiveDate(nav.activeDate)
        setViewMonth(nav.viewMonth)
        return
      }

      switch (event.key) {
        case "Enter":
        case " ":
          event.preventDefault()
          selectDate(activeDate)
          break
        case "Escape":
          // Radix dismissable layer also handles Escape; ensure controlled
          // parents see the close either way.
          setOpen(false)
          break
        default: {
          // Type-ahead: printable characters jump to a matching day.
          if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
            typeBufferRef.current += event.key
            if (typeTimerRef.current) clearTimeout(typeTimerRef.current)
            typeTimerRef.current = setTimeout(() => {
              typeBufferRef.current = ""
            }, TYPE_AHEAD_TIMEOUT)
            event.preventDefault()
            const flat = weeks.flat()
            const idx = findTypeAheadIndex(
              typeBufferRef.current,
              flat,
              flat.map((d) => [formatDayLabel(d), formatters.month.format(d)]),
              flat.findIndex((d) => isSameDay(d, activeDate)),
            )
            if (idx >= 0) {
              const target = flat[idx]
              setActiveDate(startOfDay(target))
              const month = startOfMonth(target)
              setViewMonth((m) =>
                month.getFullYear() === m.getFullYear() && month.getMonth() === m.getMonth()
                  ? m
                  : month,
              )
            }
          }
          break
        }
      }
    },
    [
      activeDate,
      viewMonth,
      weeks,
      disabled,
      isRtl,
      firstDayOfWeek,
      isDayDisabled,
      selectDate,
      setOpen,
      formatDayLabel,
      formatters,
    ],
  )

  const singleValue = asSingle(value)
  const rangeValue = asRange(value)

  // Keep the editable inputs in sync with the committed range.
  React.useEffect(() => {
    setFromText(rangeValue.from ? formatTriggerDate(rangeValue.from) : "")
    setToText(rangeValue.to ? formatTriggerDate(rangeValue.to) : "")
  }, [rangeValue.from, rangeValue.to, formatTriggerDate])

  const rangeFrom = isRange ? rangeValue.from : undefined
  const rangeTo = isRange ? rangeValue.to : undefined

  const previewRange = React.useMemo<DateRange | null>(() => {
    if (!isRange || !rangeFrom || rangeTo || !hoverDate || disabled) return null
    const a = startOfDay(rangeFrom)
    const b = startOfDay(hoverDate)
    return isBeforeDay(b, a) ? { from: b, to: a } : { from: a, to: b }
  }, [isRange, rangeFrom, rangeTo, hoverDate, disabled])

  const commitRangeInput = React.useCallback(
    (which: "from" | "to") => {
      const raw = which === "from" ? fromText : toText
      const parsed = parseDateInput(raw)
      if (raw.trim() && !parsed) {
        setInputInvalid(which)
        setInputError(true)
        return
      }
      const next: DateRange =
        which === "from" ? { from: parsed, to: rangeTo } : { from: rangeFrom, to: parsed }
      const normalized = normalizeRange(next)
      const endpoints = [normalized.from, normalized.to].filter((d): d is Date => d !== undefined)
      const endpointDisabled = endpoints.some((d) => isDayDisabled(d))
      const outOfBounds =
        (minDate && normalized.from && isBeforeDay(normalized.from, minDate)) ||
        (maxDate && normalized.to && isAfterDay(normalized.to, maxDate))
      if (endpointDisabled || outOfBounds || !isRangeWithinConstraints(normalized, constraints)) {
        setInputInvalid(which)
        setInputError(true)
        return
      }
      setInputInvalid(null)
      setInputError(false)
      setRangeError(false)
      emitChange(normalized)
      // Keep the calendar focused on the edited endpoint.
      const focusDay = normalized.to ?? normalized.from
      if (focusDay) {
        setActiveDate(startOfDay(focusDay))
        setViewMonth(startOfMonth(focusDay))
      }
    },
    [
      fromText,
      toText,
      rangeFrom,
      rangeTo,
      isDayDisabled,
      minDate,
      maxDate,
      constraints,
      emitChange,
    ],
  )

  const triggerLabel = React.useMemo(() => {
    if (isRange) {
      const label = formatRangeLabel(rangeValue, formatTriggerDate)
      return label || placeholder || labels.rangePlaceholder
    }
    return singleValue ? formatTriggerDate(singleValue) : placeholder || labels.placeholder
  }, [isRange, rangeValue, singleValue, placeholder, labels, formatTriggerDate])

  const resolvedPresets = React.useMemo<DatePickerPreset[]>(() => {
    if (presets !== undefined) return presets
    return isRange ? buildDefaultPresets(labels) : []
  }, [presets, isRange, labels])

  const yearOptions = React.useMemo(() => {
    const minYear = minDate?.getFullYear() ?? 1900
    const maxYear = maxDate?.getFullYear() ?? new Date().getFullYear() + 10
    const lo = Math.min(minYear, viewMonth.getFullYear())
    const hi = Math.max(maxYear, viewMonth.getFullYear())
    const years: number[] = []
    for (let y = lo; y <= hi; y++) years.push(y)
    return years
  }, [minDate, maxDate, viewMonth])

  const monthOptions = React.useMemo(
    () =>
      Array.from({ length: 12 }, (_, i) => ({
        value: i,
        label: formatters.month.format(new Date(2024, i, 1)),
      })),
    [formatters],
  )

  const canGoPrev =
    !minDate || startOfMonth(addMonths(viewMonth, -1)).getTime() >= startOfMonth(minDate).getTime()
  const canGoNext =
    !maxDate || startOfMonth(addMonths(viewMonth, 1)).getTime() <= startOfMonth(maxDate).getTime()

  function dayState(day: Date): DayState {
    if (isDayDisabled(day)) return "disabled"
    if (isRange && rangeFrom && rangeTo) {
      if (isSameDay(day, rangeFrom)) return "range-start"
      if (isSameDay(day, rangeTo)) return "range-end"
      if (isAfterDay(day, rangeFrom) && isBeforeDay(day, rangeTo)) {
        return "range-middle"
      }
    } else if (isRange && rangeFrom && isSameDay(day, rangeFrom)) {
      return "range-start"
    } else if (previewRange && isDayInRange(day, previewRange) && !isSameDay(day, rangeFrom!)) {
      return "range-preview"
    } else if (!isRange && singleValue && isSameDay(day, singleValue)) {
      return "selected"
    }
    const inMonth =
      day.getMonth() === viewMonth.getMonth() && day.getFullYear() === viewMonth.getFullYear()
    if (!inMonth) return "outside"
    if (isSameDay(day, today)) return "today"
    return "default"
  }

  const showRangeError = isRange && (rangeError || inputError)

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          disabled={disabled}
          data-slot="date-picker-trigger"
          className={cn(
            "justify-between font-normal",
            !singleValue && !rangeFrom && !rangeTo && "text-muted-foreground",
            className,
            triggerClassName,
          )}
        >
          <span className="flex items-center gap-2 truncate">
            <CalendarDaysIcon className="size-4 shrink-0" aria-hidden="true" />
            <span className="truncate">{triggerLabel}</span>
          </span>
          <ChevronDownIcon className="size-4 shrink-0 opacity-50" aria-hidden="true" />
        </Button>
      </PopoverPrimitive.Trigger>
      {name ? (
        <input
          type="hidden"
          name={name}
          value={
            isRange
              ? `${rangeValue.from?.toISOString() ?? ""}/${rangeValue.to?.toISOString() ?? ""}`
              : (singleValue?.toISOString() ?? "")
          }
          readOnly
        />
      ) : null}
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          data-slot="date-picker-content"
          dir={direction}
          align={align}
          side={side}
          sideOffset={sideOffset}
          className={cn(
            "bg-popover text-popover-foreground data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 z-50 flex rounded-md border shadow-md outline-none",
            contentClassName,
          )}
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            gridRef.current?.focus()
          }}
        >
          {resolvedPresets.length > 0 && (
            <div
              data-slot="date-picker-presets"
              role="group"
              aria-label={labels.presetsLabel}
              className="flex w-32 shrink-0 flex-col gap-0.5 border-e p-2"
            >
              {resolvedPresets.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => selectPreset(preset)}
                  className="hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground rounded-md px-2 py-1.5 text-start text-sm whitespace-nowrap transition-colors focus-visible:outline-none"
                >
                  {preset.label}
                </button>
              ))}
            </div>
          )}
          <div data-slot="date-picker-calendar" className={cn("p-3", calendarClassName)}>
            {isRange && (
              <div data-slot="date-picker-range-inputs" className="mb-2 grid grid-cols-2 gap-2">
                <Input
                  value={fromText}
                  onChange={(event) => {
                    setFromText(event.target.value)
                    setInputInvalid(null)
                  }}
                  onBlur={() => commitRangeInput("from")}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault()
                      commitRangeInput("from")
                    }
                  }}
                  aria-label={labels.startDate}
                  aria-invalid={inputInvalid === "from" || undefined}
                  placeholder={labels.startDate}
                  className="h-8 px-2 text-sm"
                />
                <Input
                  value={toText}
                  onChange={(event) => {
                    setToText(event.target.value)
                    setInputInvalid(null)
                  }}
                  onBlur={() => commitRangeInput("to")}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault()
                      commitRangeInput("to")
                    }
                  }}
                  aria-label={labels.endDate}
                  aria-invalid={inputInvalid === "to" || undefined}
                  placeholder={labels.endDate}
                  className="h-8 px-2 text-sm"
                />
              </div>
            )}
            {showRangeError && (
              <p role="alert" className="text-destructive mb-2 text-xs">
                {labels.invalidRange}
              </p>
            )}
            <div className="mb-2 flex items-center justify-between gap-1">
              <div className="flex items-center gap-1">
                <select
                  aria-label={labels.month}
                  className="border-input focus-visible:border-ring focus-visible:ring-ring/50 dark:bg-input/30 h-8 rounded-md border bg-transparent px-1.5 text-sm outline-none focus-visible:ring-[3px]"
                  value={viewMonth.getMonth()}
                  onChange={(event) => {
                    const month = Number(event.target.value)
                    setViewMonth(new Date(viewMonth.getFullYear(), month, 1))
                  }}
                >
                  {monthOptions.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
                <select
                  aria-label={labels.year}
                  className="border-input focus-visible:border-ring focus-visible:ring-ring/50 dark:bg-input/30 h-8 rounded-md border bg-transparent px-1.5 text-sm outline-none focus-visible:ring-[3px]"
                  value={viewMonth.getFullYear()}
                  onChange={(event) => {
                    const year = Number(event.target.value)
                    setViewMonth(new Date(year, viewMonth.getMonth(), 1))
                  }}
                >
                  {yearOptions.map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-0.5">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={labels.previousMonth}
                  disabled={!canGoPrev}
                  onClick={() => setViewMonth((m) => addMonths(m, -1))}
                >
                  <ChevronLeftIcon className="rtl:-scale-x-100" aria-hidden="true" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={labels.nextMonth}
                  disabled={!canGoNext}
                  onClick={() => setViewMonth((m) => addMonths(m, 1))}
                >
                  <ChevronRightIcon className="rtl:-scale-x-100" aria-hidden="true" />
                </Button>
              </div>
            </div>
            <div
              ref={gridRef}
              role="grid"
              aria-label={isRange ? labels.chooseDateRange : labels.chooseDate}
              aria-activedescendant={dateId(activeDate)}
              tabIndex={0}
              onKeyDown={handleGridKeyDown}
              onMouseLeave={() => setHoverDate(null)}
              className="focus-visible:ring-ring/50 rounded-md outline-none focus-visible:ring-2"
            >
              <div role="row" className="mb-1 grid grid-cols-7">
                {weekDays.map((day, i) => (
                  <div
                    key={i}
                    role="columnheader"
                    className="text-muted-foreground flex size-8 items-center justify-center text-xs font-medium"
                  >
                    {day}
                  </div>
                ))}
              </div>
              {weeks.map((week, weekIndex) => (
                <div key={weekIndex} role="row" className="grid grid-cols-7">
                  {week.map((day) => {
                    const state = dayState(day)
                    const isActive = isSameDay(day, activeDate)
                    const selected =
                      (!isRange && singleValue && isSameDay(day, singleValue)) ||
                      (isRange &&
                        ((rangeFrom && isSameDay(day, rangeFrom)) ||
                          (rangeTo && isSameDay(day, rangeTo))))
                    const inRange =
                      isRange &&
                      rangeFrom &&
                      rangeTo &&
                      isAfterDay(day, rangeFrom) &&
                      isBeforeDay(day, rangeTo)
                    const inPreview = state === "range-preview"
                    return (
                      <div
                        key={dayKey(day)}
                        role="gridcell"
                        aria-selected={selected}
                        className="flex items-center justify-center"
                      >
                        <button
                          type="button"
                          id={dateId(day)}
                          tabIndex={-1}
                          disabled={state === "disabled"}
                          aria-disabled={state === "disabled" || undefined}
                          aria-label={formatDayLabel(day)}
                          aria-current={isSameDay(day, today) ? "date" : undefined}
                          aria-pressed={selected || undefined}
                          data-active={isActive || undefined}
                          data-in-range={inRange || undefined}
                          data-preview={inPreview || undefined}
                          onClick={() => selectDate(day)}
                          onMouseEnter={() => {
                            if (isRange && rangeFrom && !rangeTo) {
                              setHoverDate(startOfDay(day))
                            }
                          }}
                          onFocus={() => setActiveDate(startOfDay(day))}
                          className={cn(
                            dayButtonVariants({ state }),
                            isActive && "ring-ring ring-offset-popover ring-2 ring-offset-1",
                          )}
                        >
                          {day.getDate()}
                        </button>
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>
          </div>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  )
}

function formatRangeLabel(range: DateRange, format: (d: Date, withYear?: boolean) => string) {
  const { from, to } = range
  if (from && to) {
    const sameYear = from.getFullYear() === to.getFullYear()
    return `${format(from)} – ${format(to, !sameYear)}`
  }
  if (from) return `${format(from)} – …`
  if (to) return `… – ${format(to)}`
  return ""
}

export { DatePicker }
