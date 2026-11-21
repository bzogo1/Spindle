"use client"

import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react"
import {
  ArrowDown,
  ArrowUp,
  Beaker,
  Braces,
  Bug,
  CalendarClock,
  CalendarDays,
  ChartColumn,
  ChevronDown,
  ChevronRight,
  Download,
  FileCode2,
  FileJson,
  FlaskConical,
  GitCompareArrows,
  History,
  Link2,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Sparkles,
  Trash2,
  Upload,
  Webhook,
  X,
  Zap,
} from "lucide-react"

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
  isScheduleValid,
  makeIntervalSchedule,
  nextScheduleRuns,
  INTERVAL_UNITS,
  type AutomationSchedule,
  type ScheduleIntervalUnit,
} from "@/lib/automations/schedule"
import { graphToStudioDraft, starterAutomationGraph } from "@/lib/automations/graph-draft"
import { automationStats, workspaceAutomationStats } from "@/lib/automations/stats"
import { storageGetJson, storageSetJson } from "@/lib/agent-runs/ops/storage"
import {
  GRAPH_TRANSFER_MAX_BYTES,
  graphTransferFormatForFileName,
  isGraphValid,
  parseGraphImport,
  serializeGraphJson,
  type AutomationGraph,
} from "@/lib/automation-graph"
import { AutomationBuilder } from "@/components/automation-builder"
import { AutomationDebugDialog } from "./automation-debug-dialog"
import { AutomationLogViewer } from "./automation-log-viewer"
import {
  AutomationScheduleCalendar,
  type ScheduleCalendarEntry,
} from "./automation-schedule-calendar"
import {
  builderStateFromCron,
  builderTriggerLabel,
  cronForBuilderSchedule,
  parseAutomationIntent,
  type BuilderFrequency,
  type ParsedIntent,
} from "@/lib/automations/intent"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { SkeletonTable } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { TooltipProvider } from "@/components/ui/tooltip"
import { useToast } from "@/components/ui/toast"
import { EmptyState } from "@/components/app/states/empty-state"
import { InlineError } from "@/components/app/states/inline-error"
import { AutomationRunLog } from "@/components/app/automation-run-log"
import {
  AutomationRunPreviewDialog,
  type AutomationRunResult,
} from "@/components/app/automation-run-preview-dialog"
import {
  AutomationScheduleDialog,
  type ScheduleDialogResult,
} from "@/components/app/automation-schedule-dialog"
import {
  AutomationVariablesDialog,
  type AutomationVariables,
} from "@/components/app/automation-variables-dialog"
import { AutomationTestDialog } from "@/components/app/automation-test-dialog"
import { AutomationTestRunDialog } from "@/components/app/automation-test-run-dialog"

import { formatDateTime, formatDurationMs, formatRelativeTime } from "./format"
import {
  AUTOMATION_SHARE_GRAPH_MAX_CHARS,
  AUTOMATION_SHARE_PARAM,
  AUTOMATION_SHARE_VERSION,
  automationShareHref,
  automationToShareConfig,
  downloadAutomationConfig,
  readAutomationShareParam,
  type AutomationShareConfig,
} from "./automation-share"
import { useNow } from "./agent-run-log-shared"
import {
  downloadAutomationRunLogCsv,
  downloadAutomationRunsCsv,
  RunDiff,
} from "./automation-run-diff"

type TriggerKind = "schedule" | "event" | "webhook"
type RunStatus = "succeeded" | "failed" | "running" | "queued" | "cancelled"
type StudioMode = "ask" | "build" | "cron" | "graph"

type AutomationTrigger = {
  kind: TriggerKind
  label: string
  detail: string
  meta?: string
}

type AutomationRun = {
  id: string
  label: string
  trigger: string
  startedAt: string
  duration: string
  /** Wall-clock duration in ms; feeds run analytics. Absent while running. */
  durationMs?: number
  status: RunStatus
  logs: string[]
}

type AutomationStepKind = "trigger" | "condition" | "action"

type AutomationStep = {
  id: string
  kind: AutomationStepKind
  label: string
  detail?: string
}

type Automation = {
  id: string
  name: string
  actionLabel: string
  actionKey?: string
  prompt: string
  trigger: AutomationTrigger
  enabled: boolean
  lastRunAt: string | null
  lastRunStatus: RunStatus | null
  runs: AutomationRun[]
  steps?: AutomationStep[]
  createdVia?: StudioMode
  /** Resolved run schedule; cron expressions also live in `trigger.meta`. */
  schedule?: AutomationSchedule
  /** When false, the workspace doesn't notify on failed runs. */
  failureAlerts: boolean
  /** User-defined variables available to the automation's steps. */
  variables?: AutomationVariables
}

/** Fully-resolved configuration produced by any of the three studio modes. */
type StudioDraft = {
  name: string
  triggerKind: TriggerKind
  /** Human-readable trigger summary shown in the table. */
  triggerDetail: string
  /** Cron expression for schedule triggers. */
  triggerMeta?: string
  /** Event name for event triggers. */
  eventName?: string
  /** Endpoint URL for webhook triggers. */
  webhookUrl?: string
  actionKey: string
  actionLabel: string
  prompt: string
  steps: AutomationStep[]
  mode: StudioMode
  /** Cron or interval schedule for schedule triggers. */
  schedule?: AutomationSchedule
  /**
   * The live graph when the draft was authored on the Graph tab (or decoded
   * from a share link that embedded one). `saveDraft` flattens it away, but
   * share links carry it so recipients get the exact canvas.
   */
  graph?: AutomationGraph
}

const ACTION_OPTIONS = [
  { value: "update-files", label: "Update project files" },
  { value: "post-summary", label: "Post run summary" },
  { value: "webhook", label: "Send webhook" },
  { value: "agent-task", label: "Run agent task" },
] as const

const CONDITION_OPTIONS = [
  { value: "changed", label: "Only when files changed since the last run" },
  { value: "new-uploads", label: "Only when new uploads exist" },
  { value: "prev-ok", label: "Skip when the previous run failed" },
] as const

const WEEKDAYS = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 0, label: "Sun" },
] as const

const CRON_PRESETS = [
  { label: "Daily 17:00", expr: "0 17 * * *" },
  { label: "Weekdays 06:00", expr: "0 6 * * 1-5" },
  { label: "Mondays 09:30", expr: "30 9 * * 1" },
  { label: "Every 15 min", expr: "*/15 * * * *" },
] as const

const MODE_LABELS: Record<StudioMode, string> = {
  ask: "Ask AI",
  build: "Builder",
  cron: "Cron",
  graph: "Graph",
}

/** localStorage key for per-automation failure-alert preferences. */
const FAILURE_ALERTS_STORAGE_KEY = "spindle.automations.failure-alerts.v1"

type FailureAlertPrefs = Record<string, boolean>

function readFailureAlertPrefs(): FailureAlertPrefs {
  const prefs = storageGetJson<unknown>(FAILURE_ALERTS_STORAGE_KEY, {})
  if (!prefs || typeof prefs !== "object" || Array.isArray(prefs)) return {}
  const result: FailureAlertPrefs = {}
  for (const [id, value] of Object.entries(prefs)) {
    if (typeof value === "boolean") result[id] = value
  }
  return result
}

function writeFailureAlertPref(id: string, enabled: boolean) {
  const prefs = readFailureAlertPrefs()
  prefs[id] = enabled
  storageSetJson(FAILURE_ALERTS_STORAGE_KEY, prefs)
}

const MOCK_AUTOMATIONS: Automation[] = [
  {
    id: "auto_daily_digest",
    name: "Daily results digest",
    actionLabel: "Post run summary",
    actionKey: "post-summary",
    prompt: "Summarize files changed since the previous run and post a concise workspace update.",
    trigger: {
      kind: "schedule",
      label: "Schedule",
      detail: "At 09:00 AM, every day",
      meta: "0 9 * * *",
    },
    enabled: true,
    failureAlerts: true,
    lastRunAt: "2026-11-19T09:00:00.000Z",
    lastRunStatus: "succeeded",
    createdVia: "ask",
    schedule: { kind: "cron", expr: "0 9 * * *" },
    variables: { channel: "#project-updates", lookback: "24h" },
    steps: [
      {
        id: "step_digest_trigger",
        kind: "trigger",
        label: "Every day at 09:00 AM",
        detail: "0 9 * * *",
      },
      {
        id: "step_digest_collect",
        kind: "action",
        label: "Collect new results since the last run",
      },
      {
        id: "step_digest_flag",
        kind: "action",
        label: "Flag outliers against the baseline",
      },
      {
        id: "step_digest_post",
        kind: "action",
        label: "Post a digest to #project-updates",
      },
    ],
    runs: [
      {
        id: "run_digest_today",
        label: "Morning digest",
        trigger: "scheduled",
        startedAt: "2026-11-19T09:00:00.000Z",
        duration: "24s",
        durationMs: 24_000,
        status: "succeeded",
        logs: [
          "09:00:01 Loaded project index (42 files)",
          "09:00:04 Scanned results/ for files changed since the last run",
          "09:00:11 Generated digest draft",
          "09:00:18 Posted summary to #project-updates",
        ],
      },
      {
        id: "run_digest_yesterday",
        label: "Morning digest",
        trigger: "scheduled",
        startedAt: "2026-11-18T09:00:00.000Z",
        duration: "19s",
        durationMs: 19_000,
        status: "succeeded",
        logs: [
          "09:00:01 Loaded project index (41 files)",
          "09:00:03 Scanned results/ for files changed since the last run",
          "09:00:12 Generated digest draft",
          "09:00:16 Posted summary to #project-updates",
        ],
      },
    ],
  },
  {
    id: "auto_survey_watch",
    name: "Survey file watch",
    actionLabel: "Update project files",
    actionKey: "update-files",
    prompt: "When a survey export lands, normalize the schema and update the project index.",
    trigger: {
      kind: "event",
      label: "Project event",
      detail: "file.uploaded",
      meta: "workspace event",
    },
    enabled: true,
    failureAlerts: true,
    lastRunAt: "2026-11-18T16:42:00.000Z",
    lastRunStatus: "failed",
    createdVia: "build",
    steps: [
      {
        id: "step_survey_trigger",
        kind: "trigger",
        label: "When file.uploaded is emitted",
      },
      {
        id: "step_survey_new",
        kind: "condition",
        label: "Only when new uploads exist",
      },
      {
        id: "step_survey_normalize",
        kind: "action",
        label: "Normalize the incoming schema",
      },
      {
        id: "step_survey_index",
        kind: "action",
        label: "Update the project index",
      },
    ],
    runs: [
      {
        id: "run_survey_failed",
        label: "Survey export update",
        trigger: "event",
        startedAt: "2026-11-18T16:42:00.000Z",
        duration: "8s",
        durationMs: 8_000,
        status: "failed",
        logs: [
          "16:42:01 Received file.uploaded for survey-export.csv",
          "16:42:03 Parsed 1,240 rows",
          "16:42:06 Failed to infer column types for station_id",
          "16:42:08 Marked run failed; no files were changed",
        ],
      },
    ],
  },
  {
    id: "auto_weekly_review",
    name: "Weekly agent review",
    actionLabel: "Run agent task",
    actionKey: "agent-task",
    prompt: "Review open lab notes, flag missing citations, and draft a short research summary.",
    trigger: {
      kind: "schedule",
      label: "Schedule",
      detail: "At 05:00 PM, every Friday",
      meta: "0 17 * * 5",
    },
    enabled: false,
    failureAlerts: true,
    lastRunAt: "2026-11-14T17:00:00.000Z",
    lastRunStatus: "succeeded",
    createdVia: "cron",
    schedule: { kind: "cron", expr: "0 17 * * 5" },
    steps: [
      {
        id: "step_review_trigger",
        kind: "trigger",
        label: "Every Friday at 05:00 PM",
        detail: "0 17 * * 5",
      },
      {
        id: "step_review_task",
        kind: "action",
        label: "Run agent task",
      },
    ],
    runs: [
      {
        id: "run_review_last_week",
        label: "Friday review",
        trigger: "scheduled",
        startedAt: "2026-11-14T17:00:00.000Z",
        duration: "41s",
        durationMs: 41_000,
        status: "succeeded",
        logs: [
          "17:00:02 Loaded 12 lab notes",
          "17:00:09 Checked citations against the project index",
          "17:00:31 Drafted weekly summary",
          "17:00:39 Saved draft to agent output",
        ],
      },
    ],
  },
]

type DraftField = "name" | "ask" | "build" | "cron" | "graph" | "prompt" | "event"
type DraftErrors = Partial<Record<DraftField, string>>

const FIELD_IDS: Record<DraftField, string> = {
  name: "automation-name",
  ask: "automation-ask",
  build: "automation-build-trigger",
  cron: "automation-cron",
  graph: "automation-builder-name",
  prompt: "automation-prompt",
  event: "automation-event",
}

let stepCounter = 0
function nextStepId(prefix: string) {
  stepCounter += 1
  return `${prefix}_${stepCounter}`
}

function actionLabelFor(key: string) {
  return ACTION_OPTIONS.find((option) => option.value === key)?.label ?? "Custom action"
}

function conditionLabelFor(key: string) {
  return CONDITION_OPTIONS.find((option) => option.value === key)?.label ?? key
}

function statusLabel(status: RunStatus | null) {
  if (!status) return "Never run"
  return status.replace(/_/g, " ")
}

/**
 * Live-updating run status pill. Re-renders on a timer — every second while a
 * run is queued/running (showing elapsed time), otherwise every 30s so the
 * label stays fresh without churning the table.
 */
function LiveRunStatus({
  status,
  startedAt,
}: {
  status: RunStatus | null
  startedAt?: string | null
}) {
  const inFlight = status === "running" || status === "queued"
  const now = useNow(inFlight ? 1000 : 30_000)
  const elapsedMs =
    inFlight && startedAt ? Math.max(0, now - new Date(startedAt).getTime()) : null
  return (
    <span
      className={`app-automation-status${status ? ` is-${status}` : ""}`}
      aria-live={inFlight ? "polite" : undefined}
    >
      <span
        className={`app-status-dot${status ? ` is-${status}` : ""}`}
        aria-hidden="true"
      />
      {statusLabel(status)}
      {elapsedMs !== null && !Number.isNaN(elapsedMs) ? (
        <small aria-hidden="true"> · {formatDurationMs(elapsedMs)}</small>
      ) : null}
    </span>
  )
}

function successRateLabel(rate: number | null) {
  return rate === null ? "—" : `${Math.round(rate * 100)}%`
}

/** Cron fallback for automations saved before `schedule` existed. */
function cronScheduleFromTrigger(automation: Automation): AutomationSchedule | null {
  if (automation.trigger.kind !== "schedule" || !automation.trigger.meta) return null
  const expr = automation.trigger.meta
  if (!humanizeCron(expr).valid) return null
  return { kind: "cron", expr }
}

/**
 * Next scheduled run for schedule triggers; null for event-driven ones.
 * Interval schedules anchor to the last run so they don't drift.
 */
function nextRunFor(automation: Automation): Date | null {
  const schedule = automation.schedule ?? cronScheduleFromTrigger(automation)
  if (!schedule || !isScheduleValid(schedule)) return null
  const anchor = automation.lastRunAt ? new Date(automation.lastRunAt) : null
  return nextScheduleRuns(schedule, 1, new Date(), anchor)[0] ?? null
}

function errorId(field: DraftField) {
  return `${FIELD_IDS[field]}-error`
}

/* ------------------------------------------------------------------------ */
/* Studio dialog — Ask AI / Builder / Cron modes                              */
/* ------------------------------------------------------------------------ */

function AskAiPanel({
  value,
  onChange,
  result,
  busy,
  onGenerate,
}: {
  value: string
  onChange: (value: string) => void
  result: ParsedIntent | null
  busy: boolean
  onGenerate: () => void
}) {
  return (
    <div className="app-automation-ask">
      <div className="app-field">
        <label htmlFor="automation-ask">Describe the automation</label>
        <Textarea
          id="automation-ask"
          className="app-textarea"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Every Friday at 5pm, review lab notes and flag missing citations."
          rows={3}
          maxLength={500}
        />
        <p className="app-field-hint">
          Plain English is fine — mention a schedule, an event, and what should happen.
        </p>
      </div>

      <div className="app-automation-ask-actions">
        <Button
          type="button"
          variant="outline"
          onClick={onGenerate}
          disabled={busy || !value.trim()}
        >
          <Sparkles aria-hidden="true" />
          {busy ? "Thinking…" : result ? "Regenerate draft" : "Generate draft"}
        </Button>
      </div>

      {result ? (
        <div className="app-automation-preview" aria-live="polite">
          <div className="app-automation-preview-head">
            <Sparkles aria-hidden="true" />
            <strong>{result.title}</strong>
          </div>
          <p className="app-automation-preview-trigger">
            {result.triggerKind === "schedule" && result.cron ? (
              <>
                <CalendarClock aria-hidden="true" />
                {humanizeCron(result.cron).text}
              </>
            ) : (
              <>
                <Zap aria-hidden="true" />
                On {result.eventName}
              </>
            )}
          </p>
          <ol className="app-automation-preview-steps">
            {result.steps.map((step, index) => (
              <li key={index}>{step}</li>
            ))}
          </ol>
          <p className="app-automation-preview-action">
            Action: {actionLabelFor(result.actionKey)}
          </p>
        </div>
      ) : null}
    </div>
  )
}

function BuilderPanel({
  triggerKind,
  onTriggerKind,
  eventName,
  onEventName,
  frequency,
  onFrequency,
  time,
  onTime,
  days,
  onToggleDay,
  conditions,
  onToggleCondition,
  actions,
  onAddAction,
  onRemoveAction,
  onMoveAction,
}: {
  triggerKind: TriggerKind
  onTriggerKind: (kind: TriggerKind) => void
  eventName: string
  onEventName: (value: string) => void
  frequency: BuilderFrequency
  onFrequency: (freq: BuilderFrequency) => void
  time: string
  onTime: (value: string) => void
  days: number[]
  onToggleDay: (day: number) => void
  conditions: string[]
  onToggleCondition: (key: string) => void
  actions: string[]
  onAddAction: (key: string) => void
  onRemoveAction: (index: number) => void
  onMoveAction: (index: number, direction: -1 | 1) => void
}) {
  const availableActions = ACTION_OPTIONS.filter((option) => !actions.includes(option.value))

  return (
    <div className="app-automation-builder">
      <div className="app-form-grid">
        <div className="app-field">
          <label htmlFor="automation-build-trigger">Trigger</label>
          <select
            id="automation-build-trigger"
            className="app-select"
            value={triggerKind}
            onChange={(event) => onTriggerKind(event.target.value as TriggerKind)}
          >
            <option value="schedule">On a schedule</option>
            <option value="event">On a project event</option>
          </select>
        </div>

        {triggerKind === "event" ? (
          <div className="app-field">
            <label htmlFor="automation-event">Event name</label>
            <Input
              id="automation-event"
              value={eventName}
              onChange={(event) => onEventName(event.target.value)}
              placeholder="file.uploaded"
            />
          </div>
        ) : (
          <div className="app-field">
            <label htmlFor="automation-build-freq">Frequency</label>
            <select
              id="automation-build-freq"
              className="app-select"
              value={frequency}
              onChange={(event) => onFrequency(event.target.value as BuilderFrequency)}
            >
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
            </select>
          </div>
        )}
      </div>

      {triggerKind === "schedule" ? (
        <div className="app-automation-builder-schedule">
          <div className="app-field">
            <label htmlFor="automation-build-time">Time</label>
            <Input
              id="automation-build-time"
              type="time"
              value={time}
              onChange={(event) => onTime(event.target.value)}
            />
          </div>
          {frequency === "weekly" ? (
            <div className="app-field">
              <span className="app-field-label" id="automation-build-days-label">
                Days
              </span>
              <div
                className="app-automation-day-pills"
                role="group"
                aria-labelledby="automation-build-days-label"
              >
                {WEEKDAYS.map((day) => {
                  const active = days.includes(day.value)
                  return (
                    <button
                      key={day.value}
                      type="button"
                      className={`app-automation-day-pill${active ? "is-active" : ""}`}
                      aria-pressed={active}
                      onClick={() => onToggleDay(day.value)}
                    >
                      {day.label}
                    </button>
                  )
                })}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      <fieldset className="app-automation-conditions">
        <legend>Conditions</legend>
        {CONDITION_OPTIONS.map((option) => {
          const checked = conditions.includes(option.value)
          return (
            <label key={option.value} className="app-automation-condition">
              <input
                type="checkbox"
                checked={checked}
                onChange={() => onToggleCondition(option.value)}
              />
              <span>{option.label}</span>
            </label>
          )
        })}
      </fieldset>

      <div className="app-field">
        <span className="app-field-label" id="automation-build-actions-label">
          Action steps
        </span>
        {actions.length === 0 ? (
          <p className="app-automation-muted">No steps yet — add at least one action.</p>
        ) : (
          <ol className="app-automation-steps">
            {actions.map((key, index) => (
              <li key={`${key}-${index}`} className="app-automation-step">
                <span className="app-automation-step-index" aria-hidden="true">
                  {index + 1}
                </span>
                <span className="app-automation-step-label">{actionLabelFor(key)}</span>
                <span className="app-automation-step-controls">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={`Move ${actionLabelFor(key)} up`}
                    disabled={index === 0}
                    onClick={() => onMoveAction(index, -1)}
                  >
                    <ArrowUp aria-hidden="true" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={`Move ${actionLabelFor(key)} down`}
                    disabled={index === actions.length - 1}
                    onClick={() => onMoveAction(index, 1)}
                  >
                    <ArrowDown aria-hidden="true" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={`Remove ${actionLabelFor(key)}`}
                    onClick={() => onRemoveAction(index)}
                  >
                    <X aria-hidden="true" />
                  </Button>
                </span>
              </li>
            ))}
          </ol>
        )}
        {availableActions.length > 0 ? (
          <select
            className="app-select app-automation-add-step"
            aria-label="Add action step"
            value=""
            onChange={(event) => {
              if (event.target.value) onAddAction(event.target.value)
            }}
          >
            <option value="" disabled>
              Add action step…
            </option>
            {availableActions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        ) : null}
      </div>
    </div>
  )
}

type CronScheduleKind = "cron" | "interval"

function CronPanel({
  kind,
  onKind,
  expr,
  onChange,
  every,
  onEvery,
  unit,
  onUnit,
  actionKey,
  onActionKey,
}: {
  kind: CronScheduleKind
  onKind: (kind: CronScheduleKind) => void
  expr: string
  onChange: (value: string) => void
  every: string
  onEvery: (value: string) => void
  unit: ScheduleIntervalUnit
  onUnit: (unit: ScheduleIntervalUnit) => void
  actionKey: string
  onActionKey: (value: string) => void
}) {
  const human = expr.trim() ? humanizeCron(expr.trim()) : null
  // Derived from the expression so manual edits keep the selector in sync.
  const preset = cronSchedulePreset(expr.trim())
  const nextRuns = human?.valid ? nextCronRuns(expr.trim(), 3) : []
  const everyNumber = Number(every)
  const intervalEveryError =
    kind === "interval"
      ? intervalError({ every: Number.isFinite(everyNumber) ? everyNumber : NaN, unit })
      : null
  const intervalSchedule =
    kind === "interval" && !intervalEveryError ? makeIntervalSchedule(everyNumber, unit) : null

  return (
    <div className="app-automation-cron">
      <div className="app-form-grid">
        <div className="app-field">
          <label htmlFor="automation-schedule-kind">Schedule</label>
          <select
            id="automation-schedule-kind"
            className="app-select"
            value={kind}
            onChange={(event) => onKind(event.target.value as CronScheduleKind)}
          >
            <option value="cron">Cron expression</option>
            <option value="interval">Fixed interval</option>
          </select>
        </div>

        {kind === "interval" ? (
          <div className="app-field">
            <label htmlFor="automation-interval-every">Repeat every</label>
            <div className="app-automation-interval">
              <Input
                id="automation-interval-every"
                type="number"
                inputMode="numeric"
                min={1}
                step={1}
                value={every}
                onChange={(event) => onEvery(event.target.value)}
                aria-invalid={Boolean(intervalEveryError)}
                aria-describedby={
                  intervalEveryError ? "automation-interval-every-error" : undefined
                }
              />
              <select
                className="app-select"
                aria-label="Interval unit"
                value={unit}
                onChange={(event) => onUnit(event.target.value as ScheduleIntervalUnit)}
              >
                {INTERVAL_UNITS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            {intervalEveryError ? (
              <p className="app-field-error" id="automation-interval-every-error">
                {intervalEveryError}
              </p>
            ) : intervalSchedule ? (
              <p className="app-field-hint">{describeSchedule(intervalSchedule)}</p>
            ) : null}
          </div>
        ) : (
          <>
            <div className="app-field">
              <label htmlFor="automation-cron-preset">Schedule type</label>
              <select
                id="automation-cron-preset"
                className="app-select"
                value={preset}
                onChange={(event) => {
                  const next = event.target.value as CronSchedulePreset
                  if (next !== "custom") onChange(cronForSchedulePreset(next, expr.trim()))
                }}
              >
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="custom">Custom cron</option>
              </select>
              <p className="app-field-hint">
                Daily and weekly fill in a cron expression; pick Custom cron to write your own.
              </p>
            </div>
            <div className="app-field">
              <label htmlFor="automation-cron">Cron expression</label>
              <Input
                id="automation-cron"
                value={expr}
                onChange={(event) => onChange(event.target.value)}
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

        <div className="app-field">
          <label htmlFor="automation-action">Action</label>
          <select
            id="automation-action"
            className="app-select"
            value={actionKey}
            onChange={(event) => onActionKey(event.target.value)}
          >
            {ACTION_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {kind === "cron" && human?.valid ? (
        <div className="app-automation-cron-meta">
          <div className="app-automation-cron-fields" aria-label="Cron fields">
            {["MIN", "HOUR", "DAY", "MONTH", "WEEK"].map((label, index) => (
              <div key={label} className="app-automation-cron-field">
                <small>{label}</small>
                <strong>{human.parts?.[index] ?? "—"}</strong>
              </div>
            ))}
          </div>
          {nextRuns.length > 0 ? (
            <div className="app-automation-next-runs">
              <span className="app-field-label">Next runs</span>
              <ul>
                {nextRuns.map((run, index) => (
                  <li key={run.toISOString()}>
                    <span>{["Next", "Then", "After"][index]}</span>
                    <strong>{formatDateTime(run.toISOString())}</strong>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="app-automation-presets" aria-label="Cron presets">
        {CRON_PRESETS.map((cronPreset) => (
          <button
            key={cronPreset.expr}
            type="button"
            className={`app-automation-preset${expr.trim() === cronPreset.expr ? "is-active" : ""}`}
            onClick={() => onChange(cronPreset.expr)}
          >
            {cronPreset.label}
          </button>
        ))}
      </div>
    </div>
  )
}

/** Convert a decoded share-link config back into a studio draft for review. */
function shareConfigToStudioDraft(config: AutomationShareConfig): StudioDraft {
  // Graph-mode links may embed the serialized canvas; parse it with the same
  // validator file imports use. Anything malformed is ignored — the draft
  // still opens with a rebuilt starter graph.
  let sharedGraph: AutomationGraph | undefined
  if (config.graph) {
    const result = parseGraphImport(config.graph, "json")
    if (result.ok) sharedGraph = result.graph
  }
  return {
    name: config.name,
    triggerKind: config.triggerKind,
    triggerDetail: config.triggerDetail,
    triggerMeta: config.triggerMeta,
    eventName: config.eventName,
    webhookUrl: config.webhookUrl,
    actionKey: config.actionKey,
    actionLabel: config.actionLabel,
    prompt: config.prompt,
    steps: config.steps.map((step) => ({
      id: nextStepId("share"),
      kind: step.kind,
      label: step.label,
      detail: step.detail,
    })),
    mode: config.mode,
    schedule: config.schedule,
    graph: sharedGraph,
  }
}

/**
 * Flatten a studio draft into the shareable config payload — the inverse of
 * `shareConfigToStudioDraft`. Graph-mode drafts embed the serialized graph
 * (dropped when it would exceed the URL-safe size cap).
 */
function studioDraftToShareConfig(draft: StudioDraft): AutomationShareConfig {
  const serializedGraph = draft.graph ? serializeGraphJson(draft.graph) : undefined
  return {
    version: AUTOMATION_SHARE_VERSION,
    name: draft.name,
    triggerKind: draft.triggerKind,
    triggerDetail: draft.triggerDetail,
    triggerMeta: draft.triggerMeta,
    eventName: draft.eventName,
    webhookUrl: draft.webhookUrl,
    actionKey: draft.actionKey,
    actionLabel: draft.actionLabel,
    prompt: draft.prompt,
    mode: draft.mode,
    schedule: draft.schedule,
    steps: draft.steps.map((step) => ({
      kind: step.kind,
      label: step.label,
      detail: step.detail,
    })),
    graph:
      serializedGraph && serializedGraph.length <= AUTOMATION_SHARE_GRAPH_MAX_CHARS
        ? serializedGraph
        : undefined,
  }
}

/**
 * Convert an imported automation graph (see `transfer.ts`) into a studio
 * draft so it opens in the create dialog for review — the same flow shared
 * links use. Returns null when the graph can't be flattened into the studio
 * model (e.g. no mappable action node).
 */
function importedGraphToStudioDraft(graph: AutomationGraph): StudioDraft | null {
  const promptNode = graph.nodes.find((node) => node.type === "agent.task")
  const prompt =
    typeof promptNode?.config.prompt === "string" ? String(promptNode.config.prompt) : ""
  const draft = graphToStudioDraft(graph, { name: graph.name, prompt })
  if (!draft) return null
  return {
    ...draft,
    actionLabel: actionLabelFor(draft.actionKey),
    schedule:
      draft.triggerKind === "schedule" && draft.triggerMeta
        ? { kind: "cron", expr: draft.triggerMeta }
        : undefined,
    // Keep the imported canvas so re-sharing the draft reproduces it exactly.
    graph,
  }
}

function StudioDialog({
  open,
  onOpenChange,
  editing,
  initialDraft,
  onSave,
  onShare,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  editing: Automation | null
  /** Pre-filled draft from a shared automation link (create mode only). */
  initialDraft?: StudioDraft | null
  onSave: (draft: StudioDraft) => void
  /** Copies a shareable link encoding the current (validated) draft. */
  onShare?: (draft: StudioDraft) => void
}) {
  const [mode, setMode] = useState<StudioMode>("ask")
  const [name, setName] = useState("")
  const [prompt, setPrompt] = useState("")

  const [askText, setAskText] = useState("")
  const [askResult, setAskResult] = useState<ParsedIntent | null>(null)
  const [askBusy, setAskBusy] = useState(false)
  const askTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [bTriggerKind, setBTriggerKind] = useState<TriggerKind>("schedule")
  const [bEventName, setBEventName] = useState("file.uploaded")
  const [bFrequency, setBFrequency] = useState<BuilderFrequency>("daily")
  const [bTime, setBTime] = useState("17:00")
  const [bDays, setBDays] = useState<number[]>([1])
  const [bConditions, setBConditions] = useState<string[]>([])
  const [bActions, setBActions] = useState<string[]>(["agent-task"])

  const [cKind, setCKind] = useState<CronScheduleKind>("cron")
  const [cExpr, setCExpr] = useState("0 17 * * *")
  const [cEvery, setCEvery] = useState("30")
  const [cUnit, setCUnit] = useState<ScheduleIntervalUnit>("minutes")
  const [cActionKey, setCActionKey] = useState<string>("agent-task")

  const [graph, setGraph] = useState<AutomationGraph>(() => starterAutomationGraph(""))

  const [errors, setErrors] = useState<DraftErrors>({})

  /**
   * Seed every tab's state from a shared-link draft so whichever mode it was
   * authored in reopens with the same values. Steps are reverse-mapped to
   * action/condition keys by label; anything unrecognised falls back to the
   * draft's primary action.
   */
  function seedSharedDraft(draft: StudioDraft) {
    setMode(draft.mode)
    setName(draft.name)
    setPrompt(draft.prompt)
    setAskText(draft.prompt)
    setAskResult(null)

    // Builder tab (schedule/event only — webhook drafts live on the Graph tab).
    setBTriggerKind(draft.triggerKind === "event" ? "event" : "schedule")
    setBEventName(draft.eventName ?? "file.uploaded")
    const cronExpr =
      draft.triggerMeta ?? (draft.schedule?.kind === "cron" ? draft.schedule.expr : "")
    const restored = cronExpr ? builderStateFromCron(cronExpr) : null
    if (restored) {
      setBFrequency(restored.frequency)
      setBTime(restored.time)
      setBDays(restored.days)
    } else {
      setBFrequency("daily")
      setBTime("17:00")
      setBDays([1])
    }
    const actionKeys = new Set<string>()
    const conditionKeys = new Set<string>()
    for (const step of draft.steps) {
      if (step.kind === "action") {
        const key = ACTION_OPTIONS.find((option) => option.label === step.label)?.value
        if (key) actionKeys.add(key)
      } else if (step.kind === "condition") {
        const key = CONDITION_OPTIONS.find((option) => option.label === step.label)?.value
        if (key) conditionKeys.add(key)
      }
    }
    setBActions(actionKeys.size > 0 ? [...actionKeys] : [draft.actionKey])
    setBConditions([...conditionKeys])

    // Cron tab.
    if (draft.schedule?.kind === "interval") {
      setCKind("interval")
      setCEvery(String(draft.schedule.every))
      setCUnit(draft.schedule.unit)
    } else {
      setCKind("cron")
      setCExpr(cronExpr || "0 17 * * *")
    }
    setCActionKey(draft.actionKey)

    // Graph tab — restore the embedded canvas when the link carried one,
    // otherwise rebuild the closest starter graph for the trigger kind.
    const graphTrigger =
      draft.triggerKind === "webhook"
        ? "webhook"
        : draft.triggerKind === "event"
          ? "event"
          : "schedule"
    setGraph(
      draft.graph ??
        starterAutomationGraph(
          draft.name,
          graphTrigger,
          graphTrigger === "webhook" ? (draft.webhookUrl ?? "") : cronExpr || "0 9 * * *",
        ),
    )
  }

  useEffect(() => {
    if (!open) return

    setErrors({})
    setName(editing?.name ?? "")
    setPrompt(editing?.prompt ?? "")

    const editingKind = editing?.trigger.kind ?? "schedule"
    setGraph(
      starterAutomationGraph(
        editing?.name ?? "",
        editingKind,
        editingKind === "webhook"
          ? (editing?.trigger.meta ?? "")
          : (editing?.trigger.meta ?? "0 9 * * *"),
      ),
    )

    if (editing) {
      const isEvent = editing.trigger.kind === "event"
      const isWebhook = editing.trigger.kind === "webhook"
      // Webhook triggers only exist in the graph model — open those on the
      // Graph tab so the endpoint config stays editable.
      setMode(isWebhook ? "graph" : isEvent ? "build" : "cron")
      if (isEvent) {
        setBTriggerKind("event")
        setBEventName(editing.trigger.detail || "file.uploaded")
      } else if (!isWebhook) {
        const intervalSchedule = editing.schedule?.kind === "interval" ? editing.schedule : null
        if (intervalSchedule) {
          setCKind("interval")
          setCEvery(String(intervalSchedule.every))
          setCUnit(intervalSchedule.unit)
        } else {
          setCKind("cron")
        }
        const cron = editing.trigger.meta ?? ""
        setCExpr(cron || "0 17 * * *")
        const restored = builderStateFromCron(cron)
        if (restored) {
          setBFrequency(restored.frequency)
          setBTime(restored.time)
          setBDays(restored.days)
        }
      }
      setBTriggerKind(isEvent ? "event" : "schedule")
      if (editing.actionKey) setCActionKey(editing.actionKey)
    } else if (initialDraft) {
      seedSharedDraft(initialDraft)
    } else {
      setMode("ask")
      setAskText("")
      setAskResult(null)
      setBTriggerKind("schedule")
      setBEventName("file.uploaded")
      setBFrequency("daily")
      setBTime("17:00")
      setBDays([1])
      setBConditions([])
      setBActions(["agent-task"])
      setCKind("cron")
      setCExpr("0 17 * * *")
      setCEvery("30")
      setCUnit("minutes")
      setCActionKey("agent-task")
      setGraph(starterAutomationGraph(""))
    }
  }, [open, editing, initialDraft])

  useEffect(
    () => () => {
      if (askTimer.current) clearTimeout(askTimer.current)
    },
    [],
  )

  function clearError(field: DraftField) {
    setErrors((current) => {
      if (!current[field]) return current
      const next = { ...current }
      delete next[field]
      return next
    })
  }

  function generateAsk() {
    const text = askText.trim()
    if (!text) {
      setErrors({ ask: "Describe the automation first." })
      return
    }
    setAskBusy(true)
    clearError("ask")
    if (askTimer.current) clearTimeout(askTimer.current)
    askTimer.current = setTimeout(() => {
      setAskResult(parseAutomationIntent(text))
      setAskBusy(false)
    }, 450)
  }

  function toggleDay(day: number) {
    setBDays((current) => {
      if (current.includes(day)) {
        if (current.length === 1) return current
        return current.filter((d) => d !== day)
      }
      return [...current, day]
    })
    clearError("build")
  }

  function toggleCondition(key: string) {
    setBConditions((current) =>
      current.includes(key) ? current.filter((k) => k !== key) : [...current, key],
    )
  }

  function addAction(key: string) {
    setBActions((current) => [...current, key])
    clearError("build")
  }

  function removeAction(index: number) {
    setBActions((current) => current.filter((_, i) => i !== index))
  }

  function moveAction(index: number, direction: -1 | 1) {
    setBActions((current) => {
      const target = index + direction
      if (target < 0 || target >= current.length) return current
      const next = [...current]
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
  }

  /** Resolve the active tab into a validated StudioDraft, or null + errors. */
  function buildDraft(): StudioDraft | null {
    const nextErrors: DraftErrors = {}

    // Ask AI derives a title from the request when the name field is blank;
    // Graph mode falls back to the builder's own name field.
    if (!name.trim() && mode !== "ask" && mode !== "graph") {
      nextErrors.name = "Name is required."
    }

    if (mode !== "ask" && !prompt.trim()) nextErrors.prompt = "Add a prompt or instructions."

    let draft: StudioDraft | null = null

    if (mode === "ask") {
      const text = askText.trim()
      if (!text) {
        nextErrors.ask = "Describe the automation first."
      } else {
        const intent = askResult ?? parseAutomationIntent(text)
        const cronHuman =
          intent.triggerKind === "schedule" && intent.cron ? humanizeCron(intent.cron) : null
        draft = {
          name: name.trim() || intent.title,
          triggerKind: intent.triggerKind,
          triggerDetail:
            intent.triggerKind === "schedule"
              ? (cronHuman?.text ?? intent.triggerLabel)
              : `On ${intent.eventName}`,
          triggerMeta: intent.cron,
          eventName: intent.eventName,
          actionKey: intent.actionKey,
          actionLabel: actionLabelFor(intent.actionKey),
          prompt: text,
          steps: [
            {
              id: nextStepId("ask_trigger"),
              kind: "trigger",
              label: intent.triggerLabel,
              detail: intent.cron,
            },
            ...intent.steps.map((label) => ({
              id: nextStepId("ask_step"),
              kind: "action" as const,
              label,
            })),
          ],
          mode: "ask",
          schedule:
            intent.triggerKind === "schedule" && intent.cron
              ? { kind: "cron", expr: intent.cron }
              : undefined,
        }
      }
    } else if (mode === "build") {
      if (bTriggerKind === "event") {
        if (!bEventName.trim()) nextErrors.event = "Event name is required."
      } else {
        const cron = cronForBuilderSchedule(bFrequency, bTime, bDays)
        if (!cron) {
          nextErrors.build = "Pick a valid time and at least one day."
        } else if (bFrequency === "weekly" && bDays.length === 0) {
          nextErrors.build = "Pick at least one weekday."
        }
      }
      if (bActions.length === 0) nextErrors.build = "Add at least one action step."

      if (Object.keys(nextErrors).length === 0) {
        const isSchedule = bTriggerKind === "schedule"
        const cron = isSchedule ? cronForBuilderSchedule(bFrequency, bTime, bDays) : null
        const triggerLabel = builderTriggerLabel({
          // The builder tab only offers schedule/event triggers; webhook
          // triggers are authored on the Graph tab.
          triggerKind: bTriggerKind === "event" ? "event" : "schedule",
          frequency: bFrequency,
          time: bTime,
          days: bDays,
          eventName: bEventName,
        })
        const steps: AutomationStep[] = [
          {
            id: nextStepId("build_trigger"),
            kind: "trigger",
            label: triggerLabel,
            detail: cron ?? bEventName.trim(),
          },
          ...bConditions.map((key) => ({
            id: nextStepId("build_cond"),
            kind: "condition" as const,
            label: conditionLabelFor(key),
          })),
          ...bActions.map((key) => ({
            id: nextStepId("build_action"),
            kind: "action" as const,
            label: actionLabelFor(key),
          })),
        ]
        draft = {
          name: name.trim(),
          triggerKind: bTriggerKind,
          triggerDetail: isSchedule
            ? humanizeCron(cron ?? "").text || triggerLabel
            : `On ${bEventName.trim()}`,
          triggerMeta: isSchedule ? (cron ?? undefined) : undefined,
          eventName: isSchedule ? undefined : bEventName.trim(),
          actionKey: bActions[0] ?? "agent-task",
          actionLabel: actionLabelFor(bActions[0] ?? "agent-task"),
          prompt: prompt.trim(),
          steps,
          mode: "build",
          schedule: isSchedule && cron ? { kind: "cron", expr: cron } : undefined,
        }
      }
    } else if (mode === "cron") {
      if (cKind === "interval") {
        const every = Number(cEvery)
        const schedule = makeIntervalSchedule(Number.isFinite(every) ? every : NaN, cUnit)
        if (!schedule) {
          nextErrors.cron =
            intervalError({
              every: Number.isFinite(every) ? every : NaN,
              unit: cUnit,
            }) ?? "Pick a valid interval."
        } else {
          const description = describeSchedule(schedule)
          draft = {
            name: name.trim(),
            triggerKind: "schedule",
            triggerDetail: description,
            actionKey: cActionKey,
            actionLabel: actionLabelFor(cActionKey),
            prompt: prompt.trim(),
            steps: [
              {
                id: nextStepId("cron_trigger"),
                kind: "trigger",
                label: description,
                detail: `${schedule.every} ${schedule.unit}`,
              },
              {
                id: nextStepId("cron_action"),
                kind: "action",
                label: actionLabelFor(cActionKey),
              },
            ],
            mode: "cron",
            schedule,
          }
        }
      } else {
        const expr = cExpr.trim()
        const human = humanizeCron(expr)
        if (!expr) {
          nextErrors.cron = "Cron expression is required."
        } else if (!human.valid) {
          nextErrors.cron = human.text
        }

        if (Object.keys(nextErrors).length === 0) {
          draft = {
            name: name.trim(),
            triggerKind: "schedule",
            triggerDetail: human.text,
            triggerMeta: expr,
            actionKey: cActionKey,
            actionLabel: actionLabelFor(cActionKey),
            prompt: prompt.trim(),
            steps: [
              {
                id: nextStepId("cron_trigger"),
                kind: "trigger",
                label: human.text,
                detail: expr,
              },
              {
                id: nextStepId("cron_action"),
                kind: "action",
                label: actionLabelFor(cActionKey),
              },
            ],
            mode: "cron",
            schedule: { kind: "cron", expr },
          }
        }
      }
    } else {
      // mode === "graph" — flatten the node graph into the shared draft model.
      const graphName = name.trim() || graph.name.trim()
      if (!graphName) {
        nextErrors.graph = "Give the automation a name."
      } else {
        // The shared "Prompt or instructions" field doubles as the prompt for
        // agent.task nodes that don't have one configured in the builder.
        const effectiveGraph: AutomationGraph = prompt.trim()
          ? {
              ...graph,
              nodes: graph.nodes.map((node) =>
                node.type === "agent.task" && !String(node.config.prompt ?? "").trim()
                  ? { ...node, config: { ...node.config, prompt: prompt.trim() } }
                  : node,
              ),
            }
          : graph
        if (!isGraphValid(effectiveGraph)) {
          nextErrors.graph = "Fix the errors in the graph before saving."
        } else {
          const converted = graphToStudioDraft(effectiveGraph, {
            name: graphName,
            prompt: prompt.trim(),
          })
          if (!converted) {
            nextErrors.graph = "The graph needs a trigger and at least one action node."
          } else {
            draft = {
              ...converted,
              actionLabel: actionLabelFor(converted.actionKey),
              schedule:
                converted.triggerKind === "schedule" && converted.triggerMeta
                  ? { kind: "cron", expr: converted.triggerMeta }
                  : undefined,
              // Keep the effective graph (with prompt backfill applied) so a
              // share link made from this draft reproduces the canvas exactly.
              graph: effectiveGraph,
            }
          }
        }
      }
    }

    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) {
      const firstField = (Object.keys(FIELD_IDS) as DraftField[]).find((field) => nextErrors[field])
      if (firstField) document.getElementById(FIELD_IDS[firstField])?.focus()
      return null
    }
    return draft
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const draft = buildDraft()
    if (draft) onSave(draft)
  }

  /**
   * Share the in-progress automation: validate like submit does, then hand
   * the draft to the panel which encodes it into a `?automation=` link.
   */
  function shareDraft() {
    const draft = buildDraft()
    if (draft) onShare?.(draft)
  }

  const hasErrors = Object.keys(errors).length > 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={
          mode === "graph"
            ? "app-automation-dialog sm:max-w-5xl"
            : "app-automation-dialog sm:max-w-2xl"
        }
      >
        <DialogHeader>
          <DialogTitle>{editing ? "Edit automation" : "New automation"}</DialogTitle>
          <DialogDescription>
            {editing
              ? "Update this workspace automation. Changes apply to local state only."
              : initialDraft
                ? "Prefilled from a shared automation link — review the config and save to add it. Saved to local state only."
                : "Create a mock automation for this workspace. It is saved to local state only."}
          </DialogDescription>
        </DialogHeader>

        <form className="app-form" onSubmit={submit} noValidate>
          {hasErrors ? (
            <InlineError title={null} message="Fix the highlighted fields before saving." />
          ) : null}

          <div className="app-field">
            <label htmlFor="automation-name">Name</label>
            <Input
              id="automation-name"
              value={name}
              onChange={(event) => {
                setName(event.target.value)
                clearError("name")
              }}
              placeholder="Daily results digest"
              maxLength={80}
              aria-required="true"
              aria-invalid={Boolean(errors.name)}
              aria-describedby={errors.name ? errorId("name") : undefined}
            />
            {errors.name ? (
              <p className="app-field-error" id={errorId("name")}>
                {errors.name}
              </p>
            ) : null}
          </div>

          <Tabs value={mode} onValueChange={(value) => setMode(value as StudioMode)}>
            <TabsList aria-label="Automation creation mode">
              <TabsTrigger value="ask">Ask AI</TabsTrigger>
              <TabsTrigger value="build">Builder</TabsTrigger>
              <TabsTrigger value="cron">Cron</TabsTrigger>
              <TabsTrigger value="graph">Graph</TabsTrigger>
            </TabsList>

            <TabsContent value="ask">
              <AskAiPanel
                value={askText}
                onChange={(value) => {
                  setAskText(value)
                  clearError("ask")
                }}
                result={askResult}
                busy={askBusy}
                onGenerate={generateAsk}
              />
              {errors.ask ? (
                <p className="app-field-error" id={errorId("ask")}>
                  {errors.ask}
                </p>
              ) : null}
            </TabsContent>

            <TabsContent value="build">
              <BuilderPanel
                triggerKind={bTriggerKind}
                onTriggerKind={(kind) => {
                  setBTriggerKind(kind)
                  clearError("build")
                  clearError("event")
                }}
                eventName={bEventName}
                onEventName={(value) => {
                  setBEventName(value)
                  clearError("event")
                }}
                frequency={bFrequency}
                onFrequency={(freq) => {
                  setBFrequency(freq)
                  clearError("build")
                }}
                time={bTime}
                onTime={(value) => {
                  setBTime(value)
                  clearError("build")
                }}
                days={bDays}
                onToggleDay={toggleDay}
                conditions={bConditions}
                onToggleCondition={toggleCondition}
                actions={bActions}
                onAddAction={addAction}
                onRemoveAction={removeAction}
                onMoveAction={moveAction}
              />
              {errors.build ? (
                <p className="app-field-error" id={errorId("build")}>
                  {errors.build}
                </p>
              ) : null}
              {errors.event ? (
                <p className="app-field-error" id={errorId("event")}>
                  {errors.event}
                </p>
              ) : null}
            </TabsContent>

            <TabsContent value="cron">
              <CronPanel
                kind={cKind}
                onKind={(kind) => {
                  setCKind(kind)
                  clearError("cron")
                }}
                expr={cExpr}
                onChange={(value) => {
                  setCExpr(value)
                  clearError("cron")
                }}
                every={cEvery}
                onEvery={(value) => {
                  setCEvery(value)
                  clearError("cron")
                }}
                unit={cUnit}
                onUnit={setCUnit}
                actionKey={cActionKey}
                onActionKey={setCActionKey}
              />
              {errors.cron ? (
                <p className="app-field-error" id={errorId("cron")}>
                  {errors.cron}
                </p>
              ) : null}
            </TabsContent>

            <TabsContent value="graph">
              <div className="h-[520px] min-h-0">
                <AutomationBuilder
                  graph={graph}
                  onGraphChange={setGraph}
                  // starterAutomationGraph mints a new graph id on every open,
                  // so scope history by the automation (or the draft session)
                  // instead of the default graph.id.
                  historyScope={editing ? `automation:${editing.id}` : "automation:draft"}
                />
              </div>
              {errors.graph ? (
                <p className="app-field-error" id={errorId("graph")}>
                  {errors.graph}
                </p>
              ) : null}
            </TabsContent>
          </Tabs>

          {mode !== "ask" ? (
            <div className="app-field">
              <label htmlFor="automation-prompt">Prompt or instructions</label>
              <Textarea
                id="automation-prompt"
                className="app-textarea"
                value={prompt}
                onChange={(event) => {
                  setPrompt(event.target.value)
                  clearError("prompt")
                }}
                placeholder="Describe what the automation should do each time it runs."
                rows={3}
                maxLength={500}
                aria-required="true"
                aria-invalid={Boolean(errors.prompt)}
                aria-describedby={errors.prompt ? errorId("prompt") : undefined}
              />
              {errors.prompt ? (
                <p className="app-field-error" id={errorId("prompt")}>
                  {errors.prompt}
                </p>
              ) : null}
            </div>
          ) : null}

          <DialogFooter>
            {onShare ? (
              <Button type="button" variant="outline" onClick={shareDraft}>
                <Link2 aria-hidden="true" />
                Share link
              </Button>
            ) : null}
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit">{editing ? "Save changes" : "Create automation"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function DeleteAutomationDialog({
  automation,
  onClose,
  onConfirm,
}: {
  automation: Automation | null
  onClose: () => void
  onConfirm: (id: string) => void
}) {
  return (
    <Dialog open={automation !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delete automation</DialogTitle>
          <DialogDescription>
            {automation
              ? `"${automation.name}" and its run history will be removed from this workspace.`
              : ""}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={() => automation && onConfirm(automation.id)}
          >
            <Trash2 aria-hidden="true" />
            Delete automation
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ------------------------------------------------------------------------ */
/* Panel                                                                      */
/* ------------------------------------------------------------------------ */

export function AutomationsPanel() {
  const { toast } = useToast()
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading")
  const [automations, setAutomations] = useState<Automation[]>([])
  const [studioOpen, setStudioOpen] = useState(false)
  const [editing, setEditing] = useState<Automation | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Automation | null>(null)
  const [expandedAutomationId, setExpandedAutomationId] = useState<string | null>(null)
  const [diffAutomationId, setDiffAutomationId] = useState<string | null>(null)
  // Draft pre-filled from a shared automation link (?automation=<config>)
  // or an imported graph file.
  const [pendingShare, setPendingShare] = useState<StudioDraft | null>(null)
  const [calendarOpen, setCalendarOpen] = useState(false)
  const [debugTarget, setDebugTarget] = useState<Automation | null>(null)
  const [runPreview, setRunPreview] = useState<{
    automation: Automation
    runId: string
  } | null>(null)
  const [scheduleTarget, setScheduleTarget] = useState<Automation | null>(null)
  const [variablesTarget, setVariablesTarget] = useState<Automation | null>(null)
  const [testTarget, setTestTarget] = useState<Automation | null>(null)
  const [testRunTarget, setTestRunTarget] = useState<Automation | null>(null)
  const importInputRef = useRef<HTMLInputElement>(null)
  // Pending simulated run completions; cleared on unmount.
  const runTimers = useRef<number[]>([])

  const load = useCallback(() => {
    setLoadState("loading")
    // Mock data source — swap for the automations API when it lands.
    Promise.resolve()
      .then(() => MOCK_AUTOMATIONS)
      .then((data) => {
        // Overlay persisted failure-alert preferences on the loaded data.
        const prefs = readFailureAlertPrefs()
        setAutomations(
          data.map((automation) =>
            Object.prototype.hasOwnProperty.call(prefs, automation.id)
              ? { ...automation, failureAlerts: prefs[automation.id] === true }
              : automation,
          ),
        )
        setLoadState("ready")
      })
      .catch(() => setLoadState("error"))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  // Shared automation links carry the full config in `?automation=`; decode
  // it once on mount, strip the param so a refresh doesn't re-import, and
  // reopen the create dialog pre-filled for review.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (!params.has(AUTOMATION_SHARE_PARAM)) return
    const config = readAutomationShareParam(window.location.search)
    const url = new URL(window.location.href)
    url.searchParams.delete(AUTOMATION_SHARE_PARAM)
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`)
    if (!config) {
      toast({
        variant: "error",
        title: "Invalid share link",
        description: "That automation link didn't contain a valid config.",
      })
      return
    }
    setEditing(null)
    setPendingShare(shareConfigToStudioDraft(config))
    setStudioOpen(true)
  }, [])

  useEffect(
    () => () => {
      runTimers.current.forEach((timer) => window.clearTimeout(timer))
      runTimers.current = []
    },
    [],
  )

  function setAutomationEnabled(id: string, enabled: boolean) {
    setAutomations((current) =>
      current.map((automation) => (automation.id === id ? { ...automation, enabled } : automation)),
    )
    const automation = automations.find((a) => a.id === id)
    toast({
      variant: enabled ? "success" : "default",
      title: enabled ? "Automation enabled" : "Automation paused",
      description: automation
        ? `"${automation.name}" ${enabled ? "will run on schedule." : "is disabled until you turn it back on."}`
        : undefined,
    })
  }

  function toggleHistory(id: string) {
    setExpandedAutomationId((current) => (current === id ? null : id))
  }

  /** Per-automation failure-alert preference, persisted in localStorage. */
  function setFailureAlerts(id: string, enabled: boolean) {
    setAutomations((current) =>
      current.map((automation) =>
        automation.id === id ? { ...automation, failureAlerts: enabled } : automation,
      ),
    )
    writeFailureAlertPref(id, enabled)
    const automation = automations.find((a) => a.id === id)
    toast({
      variant: enabled ? "success" : "default",
      title: enabled ? "Failure alerts on" : "Failure alerts off",
      description: automation
        ? `"${automation.name}" ${enabled ? "will notify you when a run fails." : "won't send failure notifications."}`
        : undefined,
    })
  }

  /**
   * Import an automation config file. Accepts the graph DSL produced by
   * `serializeGraph`/`serializeGraphYaml` (JSON or YAML, see `transfer.ts`);
   * the parsed graph is flattened into a studio draft and opened in the
   * create dialog for review — the same flow shared links use.
   */
  async function handleImportFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    // Reset so picking the same file twice still fires onChange.
    event.target.value = ""
    if (!file) return

    if (file.size > GRAPH_TRANSFER_MAX_BYTES) {
      toast({
        variant: "error",
        title: "File too large",
        description: `Automation files must be ${Math.round(GRAPH_TRANSFER_MAX_BYTES / 1024)} KB or smaller.`,
      })
      return
    }

    let source: string
    try {
      source = await file.text()
    } catch {
      toast({
        variant: "error",
        title: "Couldn't read file",
        description: `"${file.name}" could not be read — check the file and try again.`,
      })
      return
    }

    const format = graphTransferFormatForFileName(file.name)
    const result = parseGraphImport(source, format)
    if (!result.ok) {
      toast({
        variant: "error",
        title: "Import failed",
        description: result.error,
      })
      return
    }

    const draft = importedGraphToStudioDraft(result.graph)
    if (!draft) {
      toast({
        variant: "error",
        title: "Import failed",
        description:
          "The graph is valid but can't be represented as a workspace automation (it needs a recognized trigger and action).",
      })
      return
    }

    setEditing(null)
    setPendingShare(draft)
    setStudioOpen(true)
    const warnings = result.issues.filter((issue) => issue.severity === "warning").length
    toast({
      variant: "success",
      title: "Automation imported",
      description:
        `"${draft.name}" was loaded into the editor — review and save to add it.` +
        (warnings > 0 ? ` ${warnings} warning${warnings === 1 ? "" : "s"} reported by validation.` : ""),
    })
  }

  function openCreate() {
    setEditing(null)
    setPendingShare(null)
    setStudioOpen(true)
  }

  function openEdit(automation: Automation) {
    setEditing(automation)
    setPendingShare(null)
    setStudioOpen(true)
  }

  /** Copy a `?automation=` share link for an already-flattened config. */
  async function copyShareConfig(config: AutomationShareConfig) {
    try {
      await navigator.clipboard.writeText(automationShareHref(config))
      toast({
        variant: "success",
        title: "Share link copied",
        description: `"${config.name}" config is encoded in the link.`,
      })
    } catch {
      toast({
        variant: "error",
        title: "Couldn't copy link",
        description: "Clipboard access was denied — copy the URL manually instead.",
      })
    }
  }

  /**
   * Copy a shareable link encoding this automation's config in the
   * `?automation=` param — opening it re-creates the config via the studio
   * dialog (see `automation-share.ts`).
   */
  async function shareAutomation(automation: Automation) {
    await copyShareConfig(automationToShareConfig(automation))
  }

  /**
   * "Share link" button inside the studio dialog — shares the draft as
   * currently edited (including the live graph on the Graph tab) without
   * saving it first.
   */
  async function shareStudioDraft(draft: StudioDraft) {
    await copyShareConfig(studioDraftToShareConfig(draft))
  }

  /** Download the automation config as JSON or YAML (`automation-share.ts`). */
  function exportAutomationConfig(automation: Automation, format: "json" | "yaml") {
    downloadAutomationConfig(automationToShareConfig(automation), format)
  }

  function saveDraft(draft: StudioDraft) {
    const trigger: AutomationTrigger = {
      kind: draft.triggerKind,
      label:
        draft.triggerKind === "schedule"
          ? "Schedule"
          : draft.triggerKind === "webhook"
            ? "Webhook"
            : "Project event",
      detail: draft.triggerDetail,
      meta:
        draft.triggerKind === "schedule"
          ? draft.triggerMeta
          : draft.triggerKind === "webhook"
            ? draft.webhookUrl
            : "workspace event",
    }
    const schedule = draft.triggerKind === "schedule" ? draft.schedule : undefined
    setAutomations((current) => {
      if (editing) {
        return current.map((automation) =>
          automation.id === editing.id
            ? {
                ...automation,
                name: draft.name,
                actionLabel: draft.actionLabel,
                actionKey: draft.actionKey,
                prompt: draft.prompt,
                trigger,
                schedule,
                steps: draft.steps,
                createdVia: draft.mode,
              }
            : automation,
        )
      }

      const automation: Automation = {
        id: `auto_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
        name: draft.name,
        actionLabel: draft.actionLabel,
        actionKey: draft.actionKey,
        prompt: draft.prompt,
        trigger,
        schedule,
        enabled: true,
        failureAlerts: true,
        lastRunAt: null,
        lastRunStatus: null,
        runs: [],
        steps: draft.steps,
        createdVia: draft.mode,
      }
      return [automation, ...current]
    })

    toast({
      variant: "success",
      title: editing ? "Automation updated" : "Automation created",
      description: editing
        ? `"${draft.name}" was saved to local state.`
        : `"${draft.name}" was saved to local state (${MODE_LABELS[draft.mode]} mode).`,
    })
    setStudioOpen(false)
    setEditing(null)
    setPendingShare(null)
  }

  /**
   * Mock manual run — prepends a "running" entry to the automation's history
   * and stamps lastRunAt so interval schedules re-anchor from this moment.
   * A simulated completion lands a couple of seconds later so the status
   * indicator visibly transitions. Swap for the automations API when it lands.
   */
  function runNow(
    automation: Automation,
    options?: { label?: string; trigger?: string; intro?: string },
  ) {
    const startedAt = new Date().toISOString()
    const run: AutomationRun = {
      id: `run_now_${Date.now().toString(36)}`,
      label: options?.label ?? "Manual run",
      trigger: options?.trigger ?? "manual",
      startedAt,
      duration: "—",
      status: "running",
      logs: [
        `${formatDateTime(startedAt)} ${options?.intro ?? "Triggered manually from the automations panel"}`,
        "Queued for the automation runner…",
      ],
    }
    setAutomations((current) =>
      current.map((item) =>
        item.id === automation.id
          ? {
              ...item,
              lastRunAt: startedAt,
              lastRunStatus: "running" as RunStatus,
              runs: [run, ...item.runs],
            }
          : item,
      ),
    )
    toast({
      variant: "success",
      title: "Run started",
      description: `"${automation.name}" was triggered manually.`,
    })

    // Deterministic-ish mock outcome derived from the run id: ~80% succeed.
    const seed = [...run.id].reduce((acc, char) => acc + char.charCodeAt(0), 0)
    const durationMs = 2_200 + (seed % 1_800)
    const succeeded = seed % 5 !== 0
    const timer = window.setTimeout(() => {
      const finishedAt = new Date().toISOString()
      const status = (succeeded ? "succeeded" : "failed") as RunStatus
      setAutomations((current) =>
        current.map((item) => {
          if (item.id !== automation.id) return item
          // Only stamp lastRunStatus if this run is still the newest one.
          const isNewest = item.runs[0]?.id === run.id
          return {
            ...item,
            lastRunStatus: isNewest ? status : item.lastRunStatus,
            runs: item.runs.map((entry) =>
              entry.id === run.id
                ? {
                    ...entry,
                    status,
                    duration: formatDurationMs(durationMs),
                    durationMs,
                    logs: [
                      ...entry.logs,
                      succeeded
                        ? `${formatDateTime(finishedAt)} Completed in ${formatDurationMs(durationMs)}`
                        : `${formatDateTime(finishedAt)} Failed: simulated runner error after ${formatDurationMs(durationMs)}`,
                    ],
                  }
                : entry,
            ),
          }
        }),
      )
    }, durationMs)
    runTimers.current.push(timer)
  }

  /**
   * Retry — re-runs the automation with the same parameters as a previous
   * run. Pass `sourceRun` to retry a specific history entry; defaults to the
   * latest run. The mock runner doesn't distinguish parameters, so this is a
   * manual run labelled as a retry of that attempt.
   */
  function retryRun(automation: Automation, sourceRun?: AutomationRun) {
    const lastRun = sourceRun ?? automation.runs[0]
    runNow(automation, {
      label: lastRun ? `Retry of ${lastRun.label}` : "Retry run",
      trigger: "retry",
      intro: lastRun
        ? `Re-running "${automation.name}" with the same parameters as "${lastRun.label}" from ${formatDateTime(lastRun.startedAt)}`
        : `Re-running "${automation.name}" with the same parameters as the previous run`,
    })
  }

  /** Download the automation's full run history as a CSV file. */
  function exportRunLog(automation: Automation) {
    downloadAutomationRunsCsv(automation.name, automation.runs)
    toast({
      variant: "success",
      title: "Run log exported",
      description: `"${automation.name}" run history was downloaded as CSV.`,
    })
  }

  /** Download a single run's full log output as a CSV file. */
  function exportRunLogLines(automation: Automation, run: AutomationRun) {
    downloadAutomationRunLogCsv(automation.name, run)
    toast({
      variant: "success",
      title: "Run log exported",
      description: `"${run.label}" log was downloaded as CSV.`,
    })
  }

  function toggleRunDiff(id: string) {
    setDiffAutomationId((current) => (current === id ? null : id))
  }

  /**
   * "Run now" with preview: records a running entry immediately, then opens
   * the run-preview dialog which streams the simulated execution. The dialog
   * reports back via `handlePreviewFinish`/`handlePreviewProgress`.
   */
  function startRunPreview(automation: Automation) {
    const startedAt = new Date().toISOString()
    const run: AutomationRun = {
      id: `run_now_${Date.now().toString(36)}`,
      label: "Manual run",
      trigger: "manual",
      startedAt,
      duration: "—",
      status: "running",
      logs: [
        `${formatDateTime(startedAt)} Triggered manually from the automations panel`,
        "Queued for the automation runner…",
      ],
    }
    setAutomations((current) =>
      current.map((item) =>
        item.id === automation.id
          ? {
              ...item,
              lastRunAt: startedAt,
              lastRunStatus: "running" as RunStatus,
              runs: [run, ...item.runs],
            }
          : item,
      ),
    )
    setRunPreview({ automation, runId: run.id })
    toast({
      variant: "success",
      title: "Run started",
      description: `"${automation.name}" was triggered manually.`,
    })
  }

  /** Mirror streamed log lines into the pending run so history stays live. */
  function handlePreviewProgress(lines: string[]) {
    const current = runPreview
    if (!current) return
    const { automation, runId } = current
    setAutomations((items) =>
      items.map((item) =>
        item.id === automation.id
          ? {
              ...item,
              runs: item.runs.map((entry) =>
                entry.id === runId ? { ...entry, logs: lines } : entry,
              ),
            }
          : item,
      ),
    )
  }

  /** Record the preview outcome on the pending run entry. */
  function handlePreviewFinish(result: AutomationRunResult) {
    const current = runPreview
    setRunPreview(null)
    if (!current) return
    const { automation, runId } = current
    const status = result.status as RunStatus
    setAutomations((items) =>
      items.map((item) => {
        if (item.id !== automation.id) return item
        const isNewest = item.runs[0]?.id === runId
        return {
          ...item,
          lastRunStatus: isNewest ? status : item.lastRunStatus,
          runs: item.runs.map((entry) =>
            entry.id === runId
              ? {
                  ...entry,
                  status,
                  duration:
                    result.status === "cancelled"
                      ? entry.duration
                      : formatDurationMs(result.durationMs),
                  durationMs: result.durationMs,
                  logs: result.logs,
                }
              : entry,
          ),
        }
      }),
    )
    toast({
      variant: result.status === "succeeded" ? "success" : "default",
      title:
        result.status === "succeeded"
          ? "Run completed"
          : result.status === "cancelled"
            ? "Run cancelled"
            : "Run failed",
      description: `"${automation.name}" ${result.status} in ${formatDurationMs(result.durationMs)}.`,
    })
  }

  /** Persist a new schedule from the schedule modal onto the automation. */
  function saveSchedule(automationId: string, result: ScheduleDialogResult) {
    setAutomations((current) =>
      current.map((automation) =>
        automation.id === automationId
          ? {
              ...automation,
              schedule: result.schedule,
              trigger: {
                kind: "schedule" as const,
                label: "Schedule",
                detail: result.detail,
                meta: result.meta,
              },
              steps: automation.steps?.map((step, index) =>
                index === 0 && step.kind === "trigger"
                  ? {
                      ...step,
                      label: result.detail,
                      detail:
                        result.schedule.kind === "cron"
                          ? result.schedule.expr
                          : `${result.schedule.every} ${result.schedule.unit}`,
                    }
                  : step,
              ),
            }
          : automation,
      ),
    )
    const automation = automations.find((a) => a.id === automationId)
    toast({
      variant: "success",
      title: "Schedule updated",
      description: automation
        ? `"${automation.name}" now runs: ${result.detail}.`
        : result.detail,
    })
    setScheduleTarget(null)
  }

  /** Persist user-defined variables onto the automation. */
  function saveVariables(automationId: string, variables: AutomationVariables) {
    setAutomations((current) =>
      current.map((automation) =>
        automation.id === automationId ? { ...automation, variables } : automation,
      ),
    )
    const automation = automations.find((a) => a.id === automationId)
    const count = Object.keys(variables).length
    toast({
      variant: "success",
      title: "Variables saved",
      description: automation
        ? `"${automation.name}" has ${count} variable${count === 1 ? "" : "s"} defined.`
        : undefined,
    })
    setVariablesTarget(null)
  }

  function confirmDelete(id: string) {
    const automation = automations.find((a) => a.id === id)
    setAutomations((current) => current.filter((a) => a.id !== id))
    setDeleteTarget(null)
    toast({
      variant: "default",
      title: "Automation deleted",
      description: automation ? `"${automation.name}" was removed.` : undefined,
    })
  }

  const workspaceStats = workspaceAutomationStats(automations)
  const statsByAutomationId = new Map(
    automations.map((automation) => [automation.id, automationStats(automation.runs)]),
  )

  // Entries for the schedule calendar — interval schedules keep their
  // last-run anchor so occurrences line up with real executions.
  const calendarEntries = useMemo<ScheduleCalendarEntry[]>(
    () =>
      automations.map((automation) => ({
        id: automation.id,
        name: automation.name,
        enabled: automation.enabled,
        triggerKind: automation.trigger.kind,
        schedule: automation.schedule ?? cronScheduleFromTrigger(automation),
        lastRunAt: automation.lastRunAt,
        detail: automation.trigger.detail,
      })),
    [automations],
  )

  return (
    <TooltipProvider delayDuration={0}>
      <section className="app-panel app-automations" aria-labelledby="automations-heading">
        <div className="app-panel-head">
          <div>
            <h2 id="automations-heading">Automations</h2>
            <p>
              Scheduled and event-driven workflows for this workspace. Showing sample data until the
              automations API lands.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <input
              ref={importInputRef}
              type="file"
              accept=".json,.yaml,.yml,application/json"
              className="hidden"
              aria-label="Import automation file"
              onChange={(event) => void handleImportFile(event)}
            />
            <Button
              type="button"
              variant="outline"
              disabled={loadState !== "ready"}
              onClick={() => importInputRef.current?.click()}
            >
              <Upload aria-hidden="true" />
              Import
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={loadState !== "ready"}
              onClick={() => setCalendarOpen(true)}
            >
              <CalendarDays aria-hidden="true" />
              Schedule
            </Button>
            <Button type="button" onClick={openCreate} disabled={loadState !== "ready"}>
              <Plus aria-hidden="true" />
              New automation
            </Button>
          </div>
        </div>

        {loadState === "ready" && automations.length > 0 ? (
          <div className="app-automation-analytics">
            <div className="app-automation-analytics-head">
              <div>
                <h3>
                  <ChartColumn aria-hidden="true" />
                  Run analytics
                </h3>
                <p>
                  Per-automation stats computed from recorded run history — sample data until the
                  automations API lands.
                </p>
              </div>
            </div>
            <div className="app-stat-grid app-automation-analytics-summary">
              <article className="app-stat-card">
                <span className="app-stat-card-label">
                  <Zap aria-hidden="true" />
                  Automations
                </span>
                <strong>{automations.length}</strong>
                <small>
                  {automations.filter((automation) => automation.enabled).length} enabled
                </small>
              </article>
              <article className="app-stat-card">
                <span className="app-stat-card-label">
                  <History aria-hidden="true" />
                  Total runs
                </span>
                <strong>{workspaceStats.runCount}</strong>
                <small>{workspaceStats.terminalRuns} finished</small>
              </article>
              <article className="app-stat-card">
                <span className="app-stat-card-label">
                  <Play aria-hidden="true" />
                  Success rate
                </span>
                <strong>{successRateLabel(workspaceStats.successRate)}</strong>
                <small>
                  {workspaceStats.succeededCount}/{workspaceStats.terminalRuns} succeeded
                </small>
              </article>
              <article className="app-stat-card">
                <span className="app-stat-card-label">
                  <CalendarClock aria-hidden="true" />
                  Avg duration
                </span>
                <strong>
                  {workspaceStats.avgDurationMs === null
                    ? "—"
                    : formatDurationMs(workspaceStats.avgDurationMs)}
                </strong>
                <small>
                  {workspaceStats.lastRunAt
                    ? `Last run ${formatRelativeTime(workspaceStats.lastRunAt)}`
                    : "No runs yet"}
                </small>
              </article>
            </div>
            <div className="app-table-wrap">
              <table className="app-data-table app-automation-analytics-table">
                <caption className="sr-only">Per-automation run statistics</caption>
                <thead>
                  <tr>
                    <th scope="col">Automation</th>
                    <th scope="col">Runs</th>
                    <th scope="col">Success rate</th>
                    <th scope="col">Avg duration</th>
                    <th scope="col">Last run</th>
                  </tr>
                </thead>
                <tbody>
                  {automations.map((automation) => {
                    const stats = statsByAutomationId.get(automation.id) ?? automationStats([])
                    return (
                      <tr key={automation.id}>
                        <td>
                          <strong>{automation.name}</strong>
                        </td>
                        <td>{stats.runCount}</td>
                        <td>
                          {successRateLabel(stats.successRate)}
                          <small>
                            {stats.succeededCount}/{stats.terminalRuns} terminal
                          </small>
                        </td>
                        <td>
                          {stats.avgDurationMs === null
                            ? "—"
                            : formatDurationMs(stats.avgDurationMs)}
                        </td>
                        <td>
                          {stats.lastRunAt ? (
                            <time
                              dateTime={stats.lastRunAt}
                              title={formatDateTime(stats.lastRunAt)}
                            >
                              {formatRelativeTime(stats.lastRunAt)}
                            </time>
                          ) : (
                            <span className="app-automation-muted">Never</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        {loadState === "loading" ? (
          <div className="app-automation-loading" role="status" aria-label="Loading automations">
            <SkeletonTable rows={3} columns={7} />
          </div>
        ) : loadState === "error" ? (
          <div className="app-automation-error">
            <EmptyState
              title="Couldn't load automations"
              body="The automations service didn't respond. Check your connection and try again."
              primaryAction={{ label: "Try again", onClick: load }}
            />
          </div>
        ) : automations.length === 0 ? (
          <EmptyState
            icon={<Zap aria-hidden="true" />}
            title="No automations yet"
            body="Create your first automation with Ask AI, the visual builder, or a raw cron expression."
            primaryAction={{ label: "New automation", onClick: openCreate }}
          />
        ) : (
          <div className="app-table-wrap app-automation-table-wrap">
            <table className="app-data-table app-automation-table">
              <caption className="sr-only">Workspace automations</caption>
              <thead>
                <tr>
                  <th scope="col">Automation</th>
                  <th scope="col">Trigger</th>
                  <th scope="col">Next run</th>
                  <th scope="col">Last run</th>
                  <th scope="col">Status</th>
                  <th scope="col">Enabled</th>
                  <th scope="col">History</th>
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {automations.map((automation) => {
                  const expanded = expandedAutomationId === automation.id
                  const historyId = `automation-history-${automation.id}`
                  const status = automation.lastRunStatus
                  const nextRun = nextRunFor(automation)

                  return (
                    <Fragment key={automation.id}>
                      <tr>
                        <td className="app-automation-name">
                          <strong>{automation.name}</strong>
                          <small>
                            {automation.actionLabel}
                            {automation.createdVia
                              ? ` · ${MODE_LABELS[automation.createdVia]}`
                              : ""}
                          </small>
                        </td>
                        <td>
                          <span className="app-automation-trigger">
                            {automation.trigger.kind === "schedule" ? (
                              <CalendarClock aria-hidden="true" />
                            ) : automation.trigger.kind === "webhook" ? (
                              <Webhook aria-hidden="true" />
                            ) : (
                              <Zap aria-hidden="true" />
                            )}
                            <span>{automation.trigger.label}</span>
                          </span>
                          <small>
                            {automation.trigger.detail}
                            {automation.trigger.meta ? ` · ${automation.trigger.meta}` : ""}
                          </small>
                        </td>
                        <td>
                          {automation.trigger.kind === "event" ||
                          automation.trigger.kind === "webhook" ? (
                            <span className="app-automation-muted">
                              {automation.trigger.kind === "event" ? "On event" : "On webhook"}
                            </span>
                          ) : !automation.enabled ? (
                            <span className="app-automation-muted">Paused</span>
                          ) : nextRun ? (
                            <time
                              dateTime={nextRun.toISOString()}
                              title={formatDateTime(nextRun.toISOString())}
                            >
                              {formatDateTime(nextRun.toISOString())}
                            </time>
                          ) : (
                            <span className="app-automation-muted">—</span>
                          )}
                        </td>
                        <td>
                          {automation.lastRunAt ? (
                            <time
                              dateTime={automation.lastRunAt}
                              title={formatDateTime(automation.lastRunAt)}
                            >
                              {formatRelativeTime(automation.lastRunAt)}
                            </time>
                          ) : (
                            <span className="app-automation-muted">Never</span>
                          )}
                        </td>
                        <td>
                          <LiveRunStatus status={status} startedAt={automation.lastRunAt} />
                        </td>
                        <td>
                          <Switch
                            checked={automation.enabled}
                            onCheckedChange={(checked) =>
                              setAutomationEnabled(automation.id, checked)
                            }
                            aria-label={`Enable ${automation.name}`}
                          />
                        </td>
                        <td>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="app-automation-history-button"
                            aria-expanded={expanded}
                            aria-controls={expanded ? historyId : undefined}
                            aria-label={`${expanded ? "Hide" : "Show"} run history for ${automation.name}`}
                            onClick={() => toggleHistory(automation.id)}
                          >
                            {expanded ? (
                              <ChevronDown aria-hidden="true" />
                            ) : (
                              <ChevronRight aria-hidden="true" />
                            )}
                            History
                          </Button>
                        </td>
                        <td>
                          <span className="app-automation-row-actions">
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              aria-label={`Run ${automation.name} now`}
                              onClick={() => startRunPreview(automation)}
                            >
                              <Play aria-hidden="true" />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              aria-label={`Retry ${automation.name}`}
                              disabled={
                                automation.runs[0]?.status === "running" ||
                                automation.runs[0]?.status === "queued"
                              }
                              onClick={() => retryRun(automation)}
                            >
                              <RotateCcw aria-hidden="true" />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              aria-label={`Test run ${automation.name} in sandbox`}
                              onClick={() => setTestRunTarget(automation)}
                            >
                              <Beaker aria-hidden="true" />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              aria-label={`Test ${automation.name} in sandbox`}
                              onClick={() => setTestTarget(automation)}
                            >
                              <FlaskConical aria-hidden="true" />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              aria-label={`Schedule ${automation.name}`}
                              onClick={() => setScheduleTarget(automation)}
                            >
                              <CalendarClock aria-hidden="true" />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              aria-label={`Variables for ${automation.name}`}
                              onClick={() => setVariablesTarget(automation)}
                            >
                              <Braces aria-hidden="true" />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              aria-label={`Share ${automation.name}`}
                              onClick={() => void shareAutomation(automation)}
                            >
                              <Link2 aria-hidden="true" />
                            </Button>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  aria-label={`Export ${automation.name} config`}
                                >
                                  <Download aria-hidden="true" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem
                                  onSelect={() => exportAutomationConfig(automation, "json")}
                                >
                                  <FileJson aria-hidden="true" />
                                  Export JSON
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onSelect={() => exportAutomationConfig(automation, "yaml")}
                                >
                                  <FileCode2 aria-hidden="true" />
                                  Export YAML
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              aria-label={`Debug ${automation.name}`}
                              onClick={() => setDebugTarget(automation)}
                            >
                              <Bug aria-hidden="true" />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              aria-label={`Edit ${automation.name}`}
                              onClick={() => openEdit(automation)}
                            >
                              <Pencil aria-hidden="true" />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              aria-label={`Delete ${automation.name}`}
                              onClick={() => setDeleteTarget(automation)}
                            >
                              <Trash2 aria-hidden="true" />
                            </Button>
                          </span>
                        </td>
                      </tr>
                      {expanded ? (
                        <tr className="app-automation-history-row" id={historyId}>
                          <td colSpan={8}>
                            <div className="app-automation-history">
                              <div className="app-automation-history-head">
                                <div>
                                  <h3>Run history</h3>
                                  <p>
                                    Mock run log for {automation.name} — the automations API will
                                    provide live history.
                                  </p>
                                </div>
                                <div className="flex items-center gap-2">
                                  <span className="flex items-center gap-2 text-xs text-[var(--app-text-muted)]">
                                    <span>Failure alerts</span>
                                    <Switch
                                      checked={automation.failureAlerts}
                                      onCheckedChange={(checked) =>
                                        setFailureAlerts(automation.id, checked)
                                      }
                                      aria-label={`Failure alerts for ${automation.name}`}
                                    />
                                  </span>
                                  {automation.runs.length >= 2 ? (
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      aria-expanded={diffAutomationId === automation.id}
                                      onClick={() => toggleRunDiff(automation.id)}
                                    >
                                      <GitCompareArrows aria-hidden="true" />
                                      {diffAutomationId === automation.id
                                        ? "Hide run diff"
                                        : "Compare last two runs"}
                                    </Button>
                                  ) : null}
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    disabled={automation.runs.length === 0}
                                    onClick={() => exportRunLog(automation)}
                                  >
                                    <Download aria-hidden="true" />
                                    Export CSV
                                  </Button>
                                  <History aria-hidden="true" className="app-panel-icon" />
                                </div>
                              </div>
                              {diffAutomationId === automation.id &&
                              automation.runs.length >= 2 ? (
                                <RunDiff
                                  previous={automation.runs[1]}
                                  current={automation.runs[0]}
                                />
                              ) : null}
                              {automation.steps?.length ? (
                                <ol className="app-automation-step-list">
                                  {automation.steps.map((step) => (
                                    <li key={step.id} className={`is-${step.kind}`}>
                                      <span className="app-automation-step-kind">{step.kind}</span>
                                      <span>{step.label}</span>
                                      {step.detail ? <code>{step.detail}</code> : null}
                                    </li>
                                  ))}
                                </ol>
                              ) : null}
                              {automation.runs.length === 0 ? (
                                <p className="app-automation-empty">No runs yet.</p>
                              ) : (
                                <ol className="app-automation-runs">
                                  {automation.runs.map((run) => (
                                    <li key={run.id} className="app-automation-run">
                                      <div className="app-automation-run-head">
                                        <LiveRunStatus status={run.status} startedAt={run.startedAt} />
                                        <strong>{run.label}</strong>
                                        <span className="app-automation-run-trigger">
                                          {run.trigger}
                                        </span>
                                        <time dateTime={run.startedAt}>
                                          {formatDateTime(run.startedAt)}
                                        </time>
                                        <Button
                                          type="button"
                                          variant="ghost"
                                          size="sm"
                                          aria-label={`Retry "${run.label}" of ${automation.name}`}
                                          disabled={
                                            run.status === "running" ||
                                            run.status === "queued"
                                          }
                                          onClick={() => retryRun(automation, run)}
                                        >
                                          <RotateCcw aria-hidden="true" />
                                        </Button>
                                        <Button
                                          type="button"
                                          variant="ghost"
                                          size="sm"
                                          aria-label={`Export log for ${run.label}`}
                                          onClick={() => exportRunLogLines(automation, run)}
                                        >
                                          <Download aria-hidden="true" />
                                          Export log
                                        </Button>
                                        <span className="app-automation-run-duration">
                                          {run.duration}
                                        </span>
                                      </div>
                                      {run.status === "running" ? (
                                        <AutomationRunLog lines={run.logs} live />
                                      ) : (
                                        <AutomationLogViewer logs={run.logs} />
                                      )}
                                    </li>
                                  ))}
                                </ol>
                              )}
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        <StudioDialog
          open={studioOpen}
          onOpenChange={(open) => {
            setStudioOpen(open)
            if (!open) {
              setEditing(null)
              setPendingShare(null)
            }
          }}
          editing={editing}
          initialDraft={pendingShare}
          onSave={saveDraft}
          onShare={shareStudioDraft}
        />

        <DeleteAutomationDialog
          automation={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onConfirm={confirmDelete}
        />

        <AutomationScheduleCalendar
          open={calendarOpen}
          onOpenChange={setCalendarOpen}
          entries={calendarEntries}
        />

        <AutomationDebugDialog
          automation={debugTarget}
          open={debugTarget !== null}
          onOpenChange={(open) => {
            if (!open) setDebugTarget(null)
          }}
        />

        <AutomationRunPreviewDialog
          source={runPreview?.automation ?? null}
          open={runPreview !== null}
          onOpenChange={(open) => {
            if (!open) setRunPreview(null)
          }}
          onFinish={handlePreviewFinish}
          onProgress={handlePreviewProgress}
        />

        <AutomationScheduleDialog
          automationName={scheduleTarget?.name ?? ""}
          schedule={
            scheduleTarget?.schedule ??
            (scheduleTarget?.trigger.meta && humanizeCron(scheduleTarget.trigger.meta).valid
              ? { kind: "cron" as const, expr: scheduleTarget.trigger.meta }
              : null)
          }
          open={scheduleTarget !== null}
          onOpenChange={(open) => {
            if (!open) setScheduleTarget(null)
          }}
          onSave={(result) => {
            if (scheduleTarget) saveSchedule(scheduleTarget.id, result)
          }}
        />

        <AutomationVariablesDialog
          automationName={variablesTarget?.name ?? ""}
          variables={variablesTarget?.variables}
          open={variablesTarget !== null}
          onOpenChange={(open) => {
            if (!open) setVariablesTarget(null)
          }}
          onSave={(variables) => {
            if (variablesTarget) saveVariables(variablesTarget.id, variables)
          }}
        />

        <AutomationTestRunDialog
          source={testRunTarget}
          open={testRunTarget !== null}
          onOpenChange={(open) => {
            if (!open) setTestRunTarget(null)
          }}
        />

        <AutomationTestDialog
          automation={testTarget}
          open={testTarget !== null}
          onOpenChange={(open) => {
            if (!open) setTestTarget(null)
          }}
        />
      </section>
    </TooltipProvider>
  )
}
