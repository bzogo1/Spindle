"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Pause, Play, Plus, Timer, X, Zap } from "lucide-react"

import { humanizeCron } from "@/lib/automations/cron"
import {
  cancelAgentRunSchedule,
  clearScheduleStore,
  fireAgentRunSchedule,
  fireDueAgentRunSchedules,
  listAgentRunSchedules,
  pauseAgentRunSchedule,
  removeAgentRunSchedule,
  resumeAgentRunSchedule,
  saveNewAgentRunSchedule,
  updateAgentRunSchedule,
  type AgentRunSchedule,
  type ScheduleInput,
} from "@/lib/agent-runs/ops/schedule"
import { AgentRunScheduleForm } from "./agent-run-schedule-form"

/**
 * Scheduled agent runs panel: lists persisted schedules, creates new ones
 * via `AgentRunScheduleForm`, and exposes per-schedule actions —
 * run now, pause/resume, cancel, and delete. "Fire due" simulates the
 * scheduler tick by firing every schedule whose nextRunAt has passed.
 */
export function AgentRunSchedulePanel({
  onRunCreated,
  onSchedulesChanged,
}: {
  /** Called with each queued run produced by run-now / fire-due. */
  onRunCreated?: (runId: string, schedule: AgentRunSchedule) => void
  onSchedulesChanged?: (schedules: AgentRunSchedule[]) => void
} = {}) {
  const [schedules, setSchedules] = useState<AgentRunSchedule[]>(() => listAgentRunSchedules())
  const [showForm, setShowForm] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const refresh = useCallback(() => {
    const next = listAgentRunSchedules()
    setSchedules(next)
    onSchedulesChanged?.(next)
  }, [onSchedulesChanged])

  useEffect(() => {
    refresh()
  }, [refresh])

  const persist = useCallback(
    (schedule: AgentRunSchedule) => {
      updateAgentRunSchedule(schedule)
      refresh()
    },
    [refresh],
  )

  const runNow = (schedule: AgentRunSchedule) => {
    const result = fireAgentRunSchedule(schedule)
    if (!result.ok || !result.schedule) {
      setNotice(result.error ?? "Could not fire schedule.")
      return
    }
    persist(result.schedule)
    if (result.run) onRunCreated?.(result.run.id, result.schedule)
    setNotice(
      result.schedule.status === "completed"
        ? `Ran "${scheduleLabel(schedule)}" — schedule completed.`
        : `Queued run ${result.run?.id ?? ""} for "${scheduleLabel(schedule)}".`,
    )
  }

  const togglePause = (schedule: AgentRunSchedule) => {
    persist(
      schedule.status === "paused"
        ? resumeAgentRunSchedule(schedule)
        : pauseAgentRunSchedule(schedule),
    )
  }

  const cancel = (schedule: AgentRunSchedule) => {
    persist(cancelAgentRunSchedule(schedule))
    setNotice(`Cancelled "${scheduleLabel(schedule)}".`)
  }

  const remove = (schedule: AgentRunSchedule) => {
    removeAgentRunSchedule(schedule.id)
    refresh()
  }

  const fireDue = () => {
    const results = fireDueAgentRunSchedules(schedules)
    let fired = 0
    for (const { result } of results) {
      if (result.ok && result.schedule) {
        persist(result.schedule)
        fired += 1
        if (result.run) onRunCreated?.(result.run.id, result.schedule)
      }
    }
    setNotice(
      fired === 0
        ? "No schedules are due right now."
        : `Fired ${fired} due schedule${fired === 1 ? "" : "s"}.`,
    )
  }

  const create = (input: ScheduleInput) => {
    const result = saveNewAgentRunSchedule(input)
    if (!result.ok || !result.schedule) {
      setNotice(result.error ?? "Could not create schedule.")
      return
    }
    setShowForm(false)
    refresh()
    setNotice(`Schedule "${scheduleLabel(result.schedule)}" created.`)
  }

  const activeCount = useMemo(
    () => schedules.filter((s) => s.status === "active").length,
    [schedules],
  )

  return (
    <section className="app-panel" aria-labelledby="sched-panel-heading">
      <div className="app-panel-head">
        <div>
          <h2 id="sched-panel-heading">
            <Timer aria-hidden="true" className="app-panel-icon" /> Scheduled runs
          </h2>
          <p>
            {schedules.length} schedule{schedules.length === 1 ? "" : "s"} · {activeCount} active.
            Each fire instantiates a queued run record from its template.
          </p>
        </div>
        <div className="app-share-actions">
          <button type="button" className="fm-btn" onClick={fireDue} disabled={activeCount === 0}>
            <Zap aria-hidden="true" className="size-3" /> Fire due
          </button>
          <button
            type="button"
            className="fm-btn fm-btn--solid"
            onClick={() => setShowForm((v) => !v)}
            aria-expanded={showForm}
          >
            <Plus aria-hidden="true" className="size-3" /> New schedule
          </button>
        </div>
      </div>

      {notice ? (
        <p className="app-field-hint" aria-live="polite">
          {notice}
        </p>
      ) : null}

      {showForm ? (
        <AgentRunScheduleForm onSubmit={create} onCancel={() => setShowForm(false)} />
      ) : null}

      {schedules.length === 0 ? (
        <p className="app-runlog-empty-steps">
          No schedules yet — create one to run an agent template on a timer.
        </p>
      ) : (
        <table className="app-analytics-table">
          <thead>
            <tr>
              <th>Schedule</th>
              <th>Repeats</th>
              <th>Status</th>
              <th>Next run</th>
              <th>Last run</th>
              <th>Fires</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {schedules.map((schedule) => (
              <tr key={schedule.id}>
                <td>
                  <strong>{scheduleLabel(schedule)}</strong>
                  <br />
                  <code title={schedule.id}>{schedule.id}</code>
                </td>
                <td>{describeSchedule(schedule)}</td>
                <td>
                  <span className={`app-badge is-${schedule.status}`}>{schedule.status}</span>
                </td>
                <td>{formatWhen(schedule.nextRunAt)}</td>
                <td>
                  {schedule.lastRunId ? (
                    <code title={schedule.lastRunId}>{schedule.lastRunId}</code>
                  ) : (
                    "—"
                  )}
                </td>
                <td>
                  {schedule.runCount}
                  {schedule.maxRuns ? `/${schedule.maxRuns}` : ""}
                </td>
                <td>
                  <span className="app-share-actions">
                    <button
                      type="button"
                      className="fm-btn"
                      onClick={() => runNow(schedule)}
                      disabled={schedule.status === "cancelled" || schedule.status === "completed"}
                    >
                      <Play aria-hidden="true" className="size-3" /> Run now
                    </button>
                    {schedule.status === "active" || schedule.status === "paused" ? (
                      <>
                        <button
                          type="button"
                          className="fm-btn"
                          onClick={() => togglePause(schedule)}
                        >
                          {schedule.status === "paused" ? (
                            <Play aria-hidden="true" className="size-3" />
                          ) : (
                            <Pause aria-hidden="true" className="size-3" />
                          )}
                          {schedule.status === "paused" ? "Resume" : "Pause"}
                        </button>
                        <button
                          type="button"
                          className="fm-btn fm-btn--danger"
                          onClick={() => cancel(schedule)}
                        >
                          <X aria-hidden="true" className="size-3" /> Cancel
                        </button>
                      </>
                    ) : null}
                    <button
                      type="button"
                      className="fm-btn"
                      onClick={() => remove(schedule)}
                      aria-label={`Delete schedule ${scheduleLabel(schedule)}`}
                    >
                      Delete
                    </button>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <button
        type="button"
        className="fm-btn"
        onClick={() => {
          clearScheduleStore()
          refresh()
          setNotice("All schedules cleared.")
        }}
      >
        Clear all
      </button>
    </section>
  )
}

function scheduleLabel(schedule: AgentRunSchedule): string {
  return schedule.name ?? schedule.templateId ?? schedule.prompt?.slice(0, 40) ?? schedule.id
}

function formatWhen(iso: string | undefined): string {
  if (!iso) return "—"
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString()
}

function describeSchedule(schedule: AgentRunSchedule): string {
  switch (schedule.kind) {
    case "once":
      return schedule.at ? `Once at ${formatWhen(schedule.at)}` : "Once"
    case "cron": {
      if (!schedule.cron) return "Cron"
      const human = humanizeCron(schedule.cron)
      return human.valid ? human.text : `cron: ${schedule.cron}`
    }
    case "interval":
      return schedule.intervalMs
        ? `Every ${Math.round(schedule.intervalMs / 60_000)} min`
        : "Interval"
    default:
      return schedule.kind
  }
}
