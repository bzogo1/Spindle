/**
 * Core recorded-run types for the agent-runs ops toolkit.
 *
 * An "agent run" here is a *recorded* run object: a prompt, lifecycle
 * timestamps, ordered steps (thought / tool_call / result), normalized stream
 * events (see `src/lib/agent-log-stream.ts`), optional usage metrics, tags and
 * retention metadata. The ops modules in this directory (templates, sharing,
 * marketplace, analytics, debugging, profiling, optimization, security,
 * compliance, audit, backup) all operate on this shape so they compose.
 *
 * This module intentionally defines its own types rather than importing the
 * `AgentRunLogEntry` API contract: ops tooling works on exported/imported
 * snapshots, not live API rows.
 */

import type { AgentStreamEntry } from "@/lib/agent-log-stream"

export type AgentRunOpsStatus =
  "queued" | "running" | "waiting_approval" | "succeeded" | "failed" | "cancelled" | "rejected"

export type AgentRunOpsStepKind = "thought" | "tool_call" | "result"
export type AgentRunOpsStepStatus = "pending" | "running" | "done" | "failed" | "cancelled"

export interface AgentRunOpsStep {
  id: string
  kind: AgentRunOpsStepKind
  title: string
  detail?: string
  status: AgentRunOpsStepStatus
  startedAt: string
  endedAt?: string
  durationMs?: number
  /** Structured tool input/output revealed on inspection. */
  payload?: Record<string, unknown>
}

/** Usage/cost metrics captured for a run (any subset may be present). */
export interface AgentRunOpsMetrics {
  model?: string
  provider?: string
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  costUsd?: number
  durationMs?: number
}

export interface AgentRunRecord {
  id: string
  /** Human-readable title; falls back to `prompt` in UIs. */
  name?: string
  prompt: string
  status: AgentRunOpsStatus
  model?: string
  projectId?: string
  projectName?: string
  actor?: string
  createdAt: string
  startedAt?: string
  finishedAt?: string
  steps: AgentRunOpsStep[]
  /** Normalized stream events (logs, chunks, approvals, status, done, error). */
  events: AgentStreamEntry[]
  metrics: AgentRunOpsMetrics
  /** Free-form tags used by compliance rules and marketplace installs. */
  tags: string[]
  /** Retention window in days; compliance policies may require this. */
  retentionDays?: number
  templateId?: string
  templateVersion?: number
  summary?: string
}

export const ACTIVE_RUN_STATUSES: readonly AgentRunOpsStatus[] = [
  "queued",
  "running",
  "waiting_approval",
]

export function isActiveOpsRun(status: AgentRunOpsStatus): boolean {
  return ACTIVE_RUN_STATUSES.includes(status)
}

/** Effective start timestamp: `startedAt` when set, else `createdAt`. */
export function runStartIso(run: Pick<AgentRunRecord, "createdAt" | "startedAt">): string {
  return run.startedAt ?? run.createdAt
}

/**
 * Wall-clock duration in ms. For active runs pass `now` to keep it ticking;
 * returns `null` when timestamps are unparseable.
 */
export function runDurationMs(
  run: Pick<AgentRunRecord, "createdAt" | "startedAt" | "finishedAt">,
  now: number = Date.now(),
): number | null {
  const startMs = new Date(runStartIso(run)).getTime()
  const endMs = run.finishedAt ? new Date(run.finishedAt).getTime() : now
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) return null
  return Math.max(0, endMs - startMs)
}

/** Best-known duration for a step: explicit duration, else endedAt-startedAt. */
export function stepDurationMs(step: AgentRunOpsStep): number | null {
  if (typeof step.durationMs === "number" && Number.isFinite(step.durationMs)) {
    return step.durationMs
  }
  if (step.endedAt) {
    const delta = new Date(step.endedAt).getTime() - new Date(step.startedAt).getTime()
    if (!Number.isNaN(delta)) return Math.max(0, delta)
  }
  return null
}

let idCounter = 0
/** Deterministic-ish id generator for instantiated runs/steps in tests + UIs. */
export function nextOpsId(prefix = "run"): string {
  idCounter += 1
  return `${prefix}_${Date.now().toString(36)}_${idCounter.toString(36)}`
}

/** Test hook — resets the id counter between tests. */
export function resetOpsIdCounter(): void {
  idCounter = 0
}

/**
 * Normalize a possibly-lax run snapshot (share payloads, backup files,
 * hand-built fixtures) into a safe `AgentRunRecord`: guarantees `steps`,
 * `events`, `metrics`, and `tags` are well-formed collections so downstream
 * analytics/compliance/security never dereference undefined.
 *
 * Does NOT validate identity fields (id/prompt/status/createdAt) — callers
 * that import untrusted data should validate those first (see
 * `looksLikeRun`-style guards in `backup.ts` / `share.ts`).
 */
export function normalizeAgentRunRecord(run: AgentRunRecord): AgentRunRecord {
  const metrics =
    run.metrics && typeof run.metrics === "object" && !Array.isArray(run.metrics) ? run.metrics : {}
  return {
    ...run,
    steps: Array.isArray(run.steps) ? run.steps : [],
    events: Array.isArray(run.events) ? run.events : [],
    metrics,
    tags: Array.isArray(run.tags) ? run.tags.filter((t) => typeof t === "string") : [],
    createdAt:
      typeof run.createdAt === "string" && run.createdAt.length > 0
        ? run.createdAt
        : new Date(0).toISOString(),
  }
}
