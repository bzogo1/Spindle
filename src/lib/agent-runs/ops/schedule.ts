/**
 * Agent run schedules — recurring or one-shot timers that instantiate
 * recorded runs from templates (or a bare prompt) at a future time.
 *
 * Three kinds are supported:
 *
 * - `once`     — fire a single time at `at` (ISO-8601), then complete.
 * - `cron`     — five-field cron expression, evaluated in local time via
 *                `nextCronRuns` from `src/lib/automations/cron.ts`.
 * - `interval` — repeat every `intervalMs` milliseconds.
 *
 * Schedules persist to localStorage (`spindle.agent-runs.schedules.v1`) via
 * the shared storage helpers; all access is SSR-safe. Firing a schedule
 * produces a normal `queued` `AgentRunRecord` through
 * `instantiateRunFromTemplate` — the live execution path is unchanged.
 */

import { humanizeCron, nextCronRuns } from "@/lib/automations/cron"

import { instantiateRunFromTemplate, getAgentRunTemplate } from "./templates"
import { storageGetJson, storageSetJson, storageRemove } from "./storage"
import { nextOpsId, type AgentRunRecord } from "./types"

export const SCHEDULE_STORAGE_KEY = "spindle.agent-runs.schedules.v1"

/** Minimum interval for `interval` schedules — 1s keeps tests fast. */
export const MIN_INTERVAL_MS = 1_000

export type AgentRunScheduleKind = "once" | "cron" | "interval"

export type AgentRunScheduleStatus = "active" | "paused" | "completed" | "cancelled"

export interface AgentRunSchedule {
  id: string
  /** Optional human label shown in the UI. */
  name?: string
  /** Template to instantiate on each fire; optional when `prompt` is set. */
  templateId?: string
  /** Prompt override; falls back to the template prompt at fire time. */
  prompt?: string
  extraTags?: string[]
  projectId?: string
  projectName?: string
  actor?: string
  kind: AgentRunScheduleKind
  /** ISO-8601 fire time — required for `once`. */
  at?: string
  /** Five-field cron expression — required for `cron`. */
  cron?: string
  /** Repeat period in ms — required for `interval`. */
  intervalMs?: number
  status: AgentRunScheduleStatus
  createdAt: string
  updatedAt: string
  /** Next computed fire time (ISO); absent on terminal schedules. */
  nextRunAt?: string
  /** Most recent fire time (ISO). */
  lastRunAt?: string
  /** Run record id produced by the most recent fire. */
  lastRunId?: string
  /** Total fires so far. */
  runCount: number
  /** Stop after this many fires; undefined = unlimited (except `once`). */
  maxRuns?: number
}

export interface RunScheduleStore {
  version: 1
  schedules: AgentRunSchedule[]
}

/* ------------------------------------------------------------------------ */
/* Validation                                                                */
/* ------------------------------------------------------------------------ */

export interface ScheduleInput {
  name?: string
  templateId?: string
  prompt?: string
  extraTags?: string[]
  projectId?: string
  projectName?: string
  actor?: string
  kind: AgentRunScheduleKind
  at?: string
  cron?: string
  intervalMs?: number
  maxRuns?: number
}

export interface ScheduleValidation {
  ok: boolean
  errors: string[]
}

/**
 * Validate a schedule draft. Checks the kind-specific payload, cron
 * syntax, interval bounds, and that the schedule can produce a prompt
 * (template prompt or explicit override).
 */
export function validateScheduleInput(input: ScheduleInput): ScheduleValidation {
  const errors: string[] = []

  const template = input.templateId ? getAgentRunTemplate(input.templateId) : null
  if (input.templateId && !template) {
    errors.push(`Unknown template "${input.templateId}".`)
  }
  const prompt = input.prompt?.trim()
  if (!prompt && !template) {
    errors.push("A template or an explicit prompt is required.")
  }

  switch (input.kind) {
    case "once": {
      if (!input.at) {
        errors.push("A fire time (`at`) is required for one-shot schedules.")
      } else if (Number.isNaN(new Date(input.at).getTime())) {
        errors.push("`at` must be a valid ISO-8601 timestamp.")
      }
      break
    }
    case "cron": {
      if (!input.cron?.trim()) {
        errors.push("A cron expression is required for cron schedules.")
      } else if (!humanizeCron(input.cron).valid) {
        errors.push("The cron expression is invalid — use 5 fields: minute hour day month weekday.")
      }
      break
    }
    case "interval": {
      if (typeof input.intervalMs !== "number" || !Number.isFinite(input.intervalMs)) {
        errors.push("`intervalMs` must be a number of milliseconds.")
      } else if (input.intervalMs < MIN_INTERVAL_MS) {
        errors.push(`intervalMs must be at least ${MIN_INTERVAL_MS} (1s).`)
      }
      break
    }
    default:
      errors.push(`Unknown schedule kind "${String(input.kind)}".`)
  }

  if (input.maxRuns !== undefined && (!Number.isInteger(input.maxRuns) || input.maxRuns < 1)) {
    errors.push("`maxRuns` must be a positive integer.")
  }

  return { ok: errors.length === 0, errors }
}

/* ------------------------------------------------------------------------ */
/* Creation + next-fire computation                                          */
/* ------------------------------------------------------------------------ */

export interface CreateScheduleResult {
  ok: boolean
  schedule?: AgentRunSchedule
  error?: string
}

/**
 * Build a validated schedule. `nextRunAt` is computed from `now`
 * (defaults to the real clock; injectable for tests).
 */
export function createAgentRunSchedule(
  input: ScheduleInput,
  options: { now?: Date } = {},
): CreateScheduleResult {
  const validation = validateScheduleInput(input)
  if (!validation.ok) {
    return { ok: false, error: validation.errors.join(" ") }
  }
  const now = options.now ?? new Date()
  const nowIso = now.toISOString()
  const schedule: AgentRunSchedule = {
    id: nextOpsId("sched"),
    name: input.name?.trim() || undefined,
    templateId: input.templateId,
    prompt: input.prompt?.trim() || undefined,
    extraTags: input.extraTags?.length ? [...input.extraTags] : undefined,
    projectId: input.projectId,
    projectName: input.projectName,
    actor: input.actor,
    kind: input.kind,
    at: input.at,
    cron: input.cron?.trim() || undefined,
    intervalMs: input.intervalMs,
    status: "active",
    createdAt: nowIso,
    updatedAt: nowIso,
    runCount: 0,
    maxRuns: input.maxRuns,
  }
  schedule.nextRunAt = nextScheduleRunAt(schedule, now)?.toISOString()
  return { ok: true, schedule }
}

/**
 * Compute the next fire time strictly after `from`. Returns null when the
 * schedule can never fire again (one-shot already past, exhausted, or a
 * cron with no occurrence inside the scan window).
 */
export function nextScheduleRunAt(
  schedule: Pick<
    AgentRunSchedule,
    "kind" | "at" | "cron" | "intervalMs" | "createdAt" | "lastRunAt"
  >,
  from: Date = new Date(),
): Date | null {
  switch (schedule.kind) {
    case "once": {
      if (!schedule.at) return null
      const at = new Date(schedule.at)
      if (Number.isNaN(at.getTime())) return null
      return at.getTime() > from.getTime() ? at : null
    }
    case "cron": {
      if (!schedule.cron) return null
      const [next] = nextCronRuns(schedule.cron, 1, from)
      return next ?? null
    }
    case "interval": {
      if (typeof schedule.intervalMs !== "number" || schedule.intervalMs <= 0) return null
      const base = schedule.lastRunAt
        ? new Date(schedule.lastRunAt).getTime()
        : new Date(schedule.createdAt).getTime()
      if (Number.isNaN(base)) return null
      // Smallest base + k*interval strictly after `from`.
      const fromMs = from.getTime()
      const elapsed = Math.max(0, fromMs - base)
      const steps = Math.floor(elapsed / schedule.intervalMs) + 1
      return new Date(base + steps * schedule.intervalMs)
    }
    default:
      return null
  }
}

/* ------------------------------------------------------------------------ */
/* Status transitions                                                        */
/* ------------------------------------------------------------------------ */

function withStatus(
  schedule: AgentRunSchedule,
  status: AgentRunScheduleStatus,
  now: Date,
): AgentRunSchedule {
  return { ...schedule, status, updatedAt: now.toISOString() }
}

export function pauseAgentRunSchedule(
  schedule: AgentRunSchedule,
  options: { now?: Date } = {},
): AgentRunSchedule {
  if (schedule.status !== "active") return schedule
  return withStatus(schedule, "paused", options.now ?? new Date())
}

export function resumeAgentRunSchedule(
  schedule: AgentRunSchedule,
  options: { now?: Date } = {},
): AgentRunSchedule {
  if (schedule.status !== "paused") return schedule
  const now = options.now ?? new Date()
  const next = { ...withStatus(schedule, "active", now) }
  // Recompute the next fire from now — time spent paused does not count.
  next.nextRunAt = nextScheduleRunAt(next, now)?.toISOString()
  return next
}

/** Cancel a schedule: it will never fire again. Terminal. */
export function cancelAgentRunSchedule(
  schedule: AgentRunSchedule,
  options: { now?: Date } = {},
): AgentRunSchedule {
  if (schedule.status === "completed" || schedule.status === "cancelled") return schedule
  const cancelled = withStatus(schedule, "cancelled", options.now ?? new Date())
  delete cancelled.nextRunAt
  return cancelled
}

/* ------------------------------------------------------------------------ */
/* Firing                                                                    */
/* ------------------------------------------------------------------------ */

export interface FireScheduleResult {
  ok: boolean
  run?: AgentRunRecord
  schedule?: AgentRunSchedule
  error?: string
}

function instantiateFromSchedule(schedule: AgentRunSchedule, now: Date): AgentRunRecord | null {
  const template = schedule.templateId ? getAgentRunTemplate(schedule.templateId) : null
  if (template) {
    return instantiateRunFromTemplate(template, {
      prompt: schedule.prompt,
      extraTags: schedule.extraTags,
      projectId: schedule.projectId,
      projectName: schedule.projectName,
      actor: schedule.actor,
      now,
    })
  }
  const prompt = schedule.prompt?.trim()
  if (!prompt) return null
  const nowIso = now.toISOString()
  return {
    id: nextOpsId("run"),
    prompt,
    status: "queued",
    projectId: schedule.projectId,
    projectName: schedule.projectName,
    actor: schedule.actor,
    createdAt: nowIso,
    steps: [],
    events: [],
    metrics: {},
    tags: [...(schedule.extraTags ?? [])],
    templateId: schedule.templateId,
  }
}

/**
 * Fire a schedule once: instantiate the run record, advance the schedule's
 * counters/next fire time, and complete it when it was a one-shot or has
 * reached `maxRuns`. Works on paused schedules too — "run now" is an
 * explicit operator action, not a scheduled fire.
 */
export function fireAgentRunSchedule(
  schedule: AgentRunSchedule,
  options: { now?: Date } = {},
): FireScheduleResult {
  if (schedule.status === "cancelled" || schedule.status === "completed") {
    return { ok: false, error: `Schedule is ${schedule.status} and cannot fire.` }
  }
  const now = options.now ?? new Date()
  const run = instantiateFromSchedule(schedule, now)
  if (!run) {
    return { ok: false, error: "Schedule has no resolvable template or prompt." }
  }

  const next: AgentRunSchedule = {
    ...schedule,
    status: schedule.status === "paused" ? "paused" : "active",
    updatedAt: now.toISOString(),
    lastRunAt: now.toISOString(),
    lastRunId: run.id,
    runCount: schedule.runCount + 1,
  }

  const exhausted =
    schedule.kind === "once" ||
    (typeof schedule.maxRuns === "number" && next.runCount >= schedule.maxRuns)
  if (exhausted) {
    next.status = "completed"
    delete next.nextRunAt
  } else {
    // Anchor interval/cron computation on the fire time, not the old
    // nextRunAt, so manual fires don't double-count. `lastRunAt` was
    // already set to `now` above, which is the interval base.
    next.nextRunAt = nextScheduleRunAt(next, now)?.toISOString()
  }

  return { ok: true, run, schedule: next }
}

/** Active schedules whose next fire time is at or before `now`. */
export function dueAgentRunSchedules(
  schedules: readonly AgentRunSchedule[],
  now: Date = new Date(),
): AgentRunSchedule[] {
  const nowMs = now.getTime()
  return schedules.filter((schedule) => {
    if (schedule.status !== "active" || !schedule.nextRunAt) return false
    const nextMs = new Date(schedule.nextRunAt).getTime()
    return !Number.isNaN(nextMs) && nextMs <= nowMs
  })
}

/** Fire every due schedule; returns per-schedule results in input order. */
export function fireDueAgentRunSchedules(
  schedules: readonly AgentRunSchedule[],
  options: { now?: Date } = {},
): Array<{ schedule: AgentRunSchedule; result: FireScheduleResult }> {
  const now = options.now ?? new Date()
  return dueAgentRunSchedules(schedules, now).map((schedule) => {
    const result = fireAgentRunSchedule(schedule, { now })
    return { schedule: result.schedule ?? schedule, result }
  })
}

/* ------------------------------------------------------------------------ */
/* localStorage-backed store                                                 */
/* ------------------------------------------------------------------------ */

export function createScheduleStore(): RunScheduleStore {
  return { version: 1, schedules: [] }
}

export function loadScheduleStore(): RunScheduleStore {
  const stored = storageGetJson<Partial<RunScheduleStore>>(SCHEDULE_STORAGE_KEY, {})
  if (stored.version !== 1 || !Array.isArray(stored.schedules)) return createScheduleStore()
  return { version: 1, schedules: stored.schedules as AgentRunSchedule[] }
}

export function saveScheduleStore(store: RunScheduleStore): boolean {
  return storageSetJson(SCHEDULE_STORAGE_KEY, store)
}

export function clearScheduleStore(): void {
  storageRemove(SCHEDULE_STORAGE_KEY)
}

/** All persisted schedules, soonest fire first (terminal last by updatedAt). */
export function listAgentRunSchedules(): AgentRunSchedule[] {
  return [...loadScheduleStore().schedules].sort((a, b) => {
    const aKey = a.nextRunAt ?? a.updatedAt
    const bKey = b.nextRunAt ?? b.updatedAt
    return aKey.localeCompare(bKey)
  })
}

export function getAgentRunSchedule(id: string): AgentRunSchedule | null {
  return loadScheduleStore().schedules.find((s) => s.id === id) ?? null
}

function upsertSchedule(schedule: AgentRunSchedule): boolean {
  const store = loadScheduleStore()
  const index = store.schedules.findIndex((s) => s.id === schedule.id)
  if (index >= 0) store.schedules[index] = schedule
  else store.schedules.push(schedule)
  return saveScheduleStore(store)
}

/** Validate + persist a new schedule. Returns the created schedule. */
export function saveNewAgentRunSchedule(
  input: ScheduleInput,
  options: { now?: Date } = {},
): CreateScheduleResult & { persisted?: boolean } {
  const result = createAgentRunSchedule(input, options)
  if (!result.ok || !result.schedule) return result
  const persisted = upsertSchedule(result.schedule)
  return { ...result, persisted }
}

/** Persist an updated schedule (status change, fire result, edit). */
export function updateAgentRunSchedule(schedule: AgentRunSchedule): boolean {
  return upsertSchedule(schedule)
}

export function removeAgentRunSchedule(id: string): boolean {
  const store = loadScheduleStore()
  const before = store.schedules.length
  store.schedules = store.schedules.filter((s) => s.id !== id)
  if (store.schedules.length === before) return false
  return saveScheduleStore(store)
}
