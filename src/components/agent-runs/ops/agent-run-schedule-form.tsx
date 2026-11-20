"use client"

import { useMemo, useState, type FormEvent } from "react"
import { CalendarClock } from "lucide-react"

import { humanizeCron, nextCronRuns } from "@/lib/automations/cron"
import {
  validateScheduleInput,
  type AgentRunScheduleKind,
  type ScheduleInput,
} from "@/lib/agent-runs/ops/schedule"
import { listAgentRunTemplates, type AgentRunTemplate } from "@/lib/agent-runs/ops/templates"

/**
 * Schedule creation form for agent runs. Supports the three schedule kinds
 * (one-shot, cron, interval) and validates through
 * `validateScheduleInput` before handing a `ScheduleInput` to `onSubmit`.
 */
export function AgentRunScheduleForm({
  templates,
  onSubmit,
  onCancel,
}: {
  templates?: readonly AgentRunTemplate[]
  onSubmit?: (input: ScheduleInput) => void
  onCancel?: () => void
}) {
  const allTemplates = useMemo(() => templates ?? listAgentRunTemplates(), [templates])

  const [name, setName] = useState("")
  const [templateId, setTemplateId] = useState(allTemplates[0]?.id ?? "")
  const [prompt, setPrompt] = useState("")
  const [kind, setKind] = useState<AgentRunScheduleKind>("cron")
  const [at, setAt] = useState("")
  const [cron, setCron] = useState("0 9 * * 1-5")
  const [intervalMinutes, setIntervalMinutes] = useState("60")
  const [maxRuns, setMaxRuns] = useState("")
  const [errors, setErrors] = useState<string[]>([])

  const cronHuman = kind === "cron" && cron.trim() ? humanizeCron(cron.trim()) : null
  const cronNext = cronHuman?.valid ? nextCronRuns(cron.trim(), 3) : []

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const input: ScheduleInput = {
      name: name.trim() || undefined,
      templateId: templateId || undefined,
      prompt: prompt.trim() || undefined,
      kind,
      at: kind === "once" && at ? new Date(at).toISOString() : undefined,
      cron: kind === "cron" ? cron.trim() : undefined,
      intervalMs: kind === "interval" ? Math.round(Number(intervalMinutes) * 60_000) : undefined,
      maxRuns: maxRuns.trim() ? Number(maxRuns) : undefined,
    }
    const validation = validateScheduleInput(input)
    if (!validation.ok) {
      setErrors(validation.errors)
      return
    }
    setErrors([])
    onSubmit?.(input)
  }

  return (
    <form className="app-sched-form" onSubmit={submit} aria-labelledby="sched-form-heading">
      <h3 id="sched-form-heading">New run schedule</h3>

      <div className="app-field">
        <label htmlFor="sched-name">Name (optional)</label>
        <input
          id="sched-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Nightly code review"
          maxLength={120}
        />
      </div>

      <div className="app-field">
        <label htmlFor="sched-template">Template</label>
        <select
          id="sched-template"
          className="app-select"
          value={templateId}
          onChange={(event) => setTemplateId(event.target.value)}
        >
          <option value="">Custom prompt (no template)</option>
          {allTemplates.map((template) => (
            <option key={template.id} value={template.id}>
              {template.name}
            </option>
          ))}
        </select>
      </div>

      <div className="app-field">
        <label htmlFor="sched-prompt">Prompt {templateId ? "(override, optional)" : ""}</label>
        <textarea
          id="sched-prompt"
          className="app-textarea"
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder={
            templateId
              ? "Leave blank to use the template prompt."
              : "Describe what the agent should do on each run."
          }
          rows={3}
          maxLength={2000}
          required={!templateId}
        />
      </div>

      <div className="app-form-grid">
        <div className="app-field">
          <label htmlFor="sched-kind">Repeats</label>
          <select
            id="sched-kind"
            className="app-select"
            value={kind}
            onChange={(event) => setKind(event.target.value as AgentRunScheduleKind)}
          >
            <option value="once">Once</option>
            <option value="cron">On a cron schedule</option>
            <option value="interval">Every N minutes</option>
          </select>
        </div>

        {kind === "once" ? (
          <div className="app-field">
            <label htmlFor="sched-at">Run at</label>
            <input
              id="sched-at"
              type="datetime-local"
              value={at}
              onChange={(event) => setAt(event.target.value)}
              required
            />
          </div>
        ) : null}

        {kind === "interval" ? (
          <div className="app-field">
            <label htmlFor="sched-interval">Interval (minutes)</label>
            <input
              id="sched-interval"
              type="number"
              min={1}
              step={1}
              value={intervalMinutes}
              onChange={(event) => setIntervalMinutes(event.target.value)}
              required
            />
          </div>
        ) : null}

        <div className="app-field">
          <label htmlFor="sched-max-runs">Max runs (optional)</label>
          <input
            id="sched-max-runs"
            type="number"
            min={1}
            step={1}
            value={maxRuns}
            onChange={(event) => setMaxRuns(event.target.value)}
            placeholder="Unlimited"
          />
        </div>
      </div>

      {kind === "cron" ? (
        <div className="app-field">
          <label htmlFor="sched-cron">Cron expression</label>
          <input
            id="sched-cron"
            value={cron}
            onChange={(event) => setCron(event.target.value)}
            placeholder="0 9 * * 1-5"
            required
          />
          <p className="app-field-hint">
            <CalendarClock aria-hidden="true" /> Five fields: minute hour day month weekday.
          </p>
          {cronHuman ? (
            <p className="app-field-hint" aria-live="polite">
              {cronHuman.text}
              {cronNext.length > 0 ? (
                <> — next: {cronNext.map((run) => run.toLocaleString()).join(", ")}</>
              ) : null}
            </p>
          ) : null}
        </div>
      ) : null}

      {errors.length > 0 ? (
        <ul className="app-sched-errors" role="alert">
          {errors.map((error) => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      ) : null}

      <div className="app-share-actions">
        <button type="submit" className="fm-btn fm-btn--solid">
          Create schedule
        </button>
        {onCancel ? (
          <button type="button" className="fm-btn" onClick={onCancel}>
            Cancel
          </button>
        ) : null}
      </div>
    </form>
  )
}
