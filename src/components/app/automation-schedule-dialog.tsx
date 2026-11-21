"use client"

import { useEffect, useMemo, useState, type FormEvent } from "react"
import { CalendarClock } from "lucide-react"

import {
  cronForSchedulePreset,
  cronSchedulePreset,
  humanizeCron,
  nextCronRuns,
  type CronSchedulePreset,
} from "@/lib/automations/cron"
import {
  describeSchedule,
  intervalError,
  makeIntervalSchedule,
  INTERVAL_UNITS,
  type AutomationSchedule,
  type ScheduleIntervalUnit,
} from "@/lib/automations/schedule"
import { formatDateTime } from "@/components/app/format"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"

export interface ScheduleDialogResult {
  schedule: AutomationSchedule
  /** Human-readable schedule summary stored as the trigger detail. */
  detail: string
  /** Cron expression for schedule triggers; undefined for intervals. */
  meta?: string
}

const CRON_PRESETS = [
  { label: "Daily 17:00", expr: "0 17 * * *" },
  { label: "Weekdays 06:00", expr: "0 6 * * 1-5" },
  { label: "Mondays 09:30", expr: "30 9 * * 1" },
  { label: "Every 15 min", expr: "*/15 * * * *" },
] as const

type ScheduleKind = "cron" | "interval"

/**
 * "Automation schedule" modal: pick a cron expression or fixed interval for
 * an automation and preview when it will next run. Reuses the same cron /
 * schedule helpers as the studio dialog so descriptions stay consistent.
 */
export function AutomationScheduleDialog({
  automationName,
  schedule,
  open,
  onOpenChange,
  onSave,
}: {
  automationName: string
  /** Current resolved schedule, when the automation already has one. */
  schedule?: AutomationSchedule | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSave: (result: ScheduleDialogResult) => void
}) {
  const [kind, setKind] = useState<ScheduleKind>("cron")
  const [expr, setExpr] = useState("")
  const [every, setEvery] = useState("30")
  const [unit, setUnit] = useState<ScheduleIntervalUnit>("minutes")
  const [error, setError] = useState<string | null>(null)

  // Seed the form from the automation's current schedule each time it opens.
  useEffect(() => {
    if (!open) return
    setError(null)
    if (schedule?.kind === "interval") {
      setKind("interval")
      setEvery(String(schedule.every))
      setUnit(schedule.unit)
    } else {
      setKind("cron")
      setExpr(schedule?.kind === "cron" ? schedule.expr : "")
    }
  }, [open, schedule])

  const human = useMemo(
    () => (expr.trim() ? humanizeCron(expr.trim()) : null),
    [expr],
  )
  // The daily/weekly/custom selector is derived from the expression itself,
  // so manual edits keep it in sync automatically.
  const preset = useMemo<CronSchedulePreset>(() => cronSchedulePreset(expr.trim()), [expr])
  const cronValid = kind === "cron" && Boolean(human?.valid)
  const nextCron = useMemo(
    () => (cronValid ? nextCronRuns(expr.trim(), 3) : []),
    [cronValid, expr],
  )

  const everyNumber = Number(every)
  const intervalSchedule =
    kind === "interval" && Number.isFinite(everyNumber)
      ? makeIntervalSchedule(everyNumber, unit)
      : null
  const intervalErr =
    kind === "interval" && every.trim()
      ? intervalError({
          every: Number.isFinite(everyNumber) ? everyNumber : NaN,
          unit,
        })
      : null

  const canSave = kind === "cron" ? cronValid : intervalSchedule !== null && !intervalErr

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (kind === "cron") {
      const trimmed = expr.trim()
      const humanized = humanizeCron(trimmed)
      if (!humanized.valid) {
        setError(humanized.text)
        return
      }
      onSave({
        schedule: { kind: "cron", expr: trimmed },
        detail: humanized.text,
        meta: trimmed,
      })
      return
    }

    const schedule = intervalSchedule
    if (!schedule || intervalErr) {
      setError(intervalErr ?? "Pick a valid interval.")
      return
    }
    onSave({
      schedule,
      detail: describeSchedule(schedule),
      meta: undefined,
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            <span className="inline-flex items-center gap-2">
              <CalendarClock aria-hidden="true" className="size-4" />
              Schedule — {automationName}
            </span>
          </DialogTitle>
          <DialogDescription>
            Set when this automation runs. Cron expressions and fixed intervals are both
            supported; changes apply to local state only.
          </DialogDescription>
        </DialogHeader>

        <form className="app-form" onSubmit={submit} noValidate>
          <div className="app-field">
            <label htmlFor="automation-schedule-kind">Schedule</label>
            <select
              id="automation-schedule-kind"
              className="app-select"
              value={kind}
              onChange={(event) => {
                setKind(event.target.value as ScheduleKind)
                setError(null)
              }}
            >
              <option value="cron">Cron expression</option>
              <option value="interval">Fixed interval</option>
            </select>
          </div>

          {kind === "interval" ? (
            <div className="app-field">
              <label htmlFor="automation-schedule-every">Repeat every</label>
              <div className="app-automation-interval">
                <Input
                  id="automation-schedule-every"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  step={1}
                  value={every}
                  onChange={(event) => {
                    setEvery(event.target.value)
                    setError(null)
                  }}
                  aria-invalid={Boolean(intervalErr)}
                />
                <select
                  className="app-select"
                  aria-label="Interval unit"
                  value={unit}
                  onChange={(event) => setUnit(event.target.value as ScheduleIntervalUnit)}
                >
                  {INTERVAL_UNITS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              {intervalErr ? (
                <p className="app-field-error">{intervalErr}</p>
              ) : intervalSchedule ? (
                <p className="app-field-hint">{describeSchedule(intervalSchedule)}</p>
              ) : null}
            </div>
          ) : (
            <>
              <div className="app-field">
                <label htmlFor="automation-schedule-preset">Schedule type</label>
                <select
                  id="automation-schedule-preset"
                  className="app-select"
                  value={preset}
                  onChange={(event) => {
                    const next = event.target.value as CronSchedulePreset
                    if (next !== "custom") {
                      setExpr(cronForSchedulePreset(next, expr.trim()))
                    }
                    setError(null)
                  }}
                >
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="custom">Custom cron</option>
                </select>
                <p className="app-field-hint">
                  Daily and weekly fill in a cron expression below; pick Custom cron to write
                  your own.
                </p>
              </div>
              <div className="app-field">
                <label htmlFor="automation-schedule-cron">Cron expression</label>
                <Input
                  id="automation-schedule-cron"
                  value={expr}
                  onChange={(event) => {
                    setExpr(event.target.value)
                    setError(null)
                  }}
                  placeholder="0 9 * * 1"
                  className="app-automation-cron-input"
                  spellCheck={false}
                />
                {human ? (
                  human.valid ? (
                    <p className="app-field-hint">{human.text}</p>
                  ) : (
                    <p className="app-field-error">{human.text}</p>
                  )
                ) : (
                  <p className="app-field-hint">Use a five-field cron expression.</p>
                )}
              </div>
            </>
          )}

          {kind === "cron" && human?.valid ? (
            <div className="app-automation-next-runs">
              <span className="app-field-label">Next runs</span>
              <ul>
                {nextCron.map((run, index) => (
                  <li key={run.toISOString()}>
                    <span>{["Next", "Then", "After"][index]}</span>
                    <strong>{formatDateTime(run.toISOString())}</strong>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {kind === "cron" ? (
            <div className="app-automation-presets" aria-label="Cron presets">
              {CRON_PRESETS.map((cronPreset) => (
                <button
                  key={cronPreset.expr}
                  type="button"
                  className={`app-automation-preset${expr.trim() === cronPreset.expr ? "is-active" : ""}`}
                  onClick={() => {
                    setExpr(cronPreset.expr)
                    setError(null)
                  }}
                >
                  {cronPreset.label}
                </button>
              ))}
            </div>
          ) : null}

          {error ? <p className="app-field-error">{error}</p> : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canSave}>
              Save schedule
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
