/**
 * Core lifecycle types for recorded agent runs.
 *
 * An `AgentRun` is a self-contained record: an ordered event log plus metrics,
 * checkpoints, and optional branch/merge metadata. All lifecycle modules in
 * this directory (`cost`, `cache`, `parallel`, `stream`, `checkpoints`,
 * `rollback`, `branching`, `merge`) operate on these immutable-ish shapes —
 * functions return new objects rather than mutating in place.
 */

export type AgentRunStatus = "pending" | "queued" | "running" | "completed" | "failed" | "cancelled"

export type AgentRunEventType =
  "step" | "tool" | "message" | "approval" | "metric" | "status" | "checkpoint" | "error"

export type AgentRunEventStatus = "ok" | "error" | "skipped" | "running"

/**
 * One recorded event in a run's append-only log. `seq` is the 1-based
 * position within the branch's own event list; `name` is the stable key used
 * for cost attribution, parallel lane grouping, and merge conflict detection.
 */
export interface AgentRunEvent {
  id: string
  seq: number
  /** ISO-8601 timestamp. */
  timestamp: string
  type: AgentRunEventType
  /** Step/tool/message name — primary identity for grouping and merging. */
  name: string
  summary?: string
  payload?: Record<string, unknown>
  /** Tokens consumed producing this event, when known. */
  tokens?: number
  durationMs?: number
  status?: AgentRunEventStatus
  /** Parallel lane / branch hint, when the run recorded one. */
  lane?: string
  /** Branch id this event was appended under (set by `appendBranchEvent`). */
  branchId?: string
}

export interface AgentRunMetrics {
  durationMs?: number
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  steps?: number
  toolCalls?: number
  cacheHits?: number
  costUsd?: number
}

/** A named or automatic snapshot of run state at a point in the log. */
export interface AgentRunCheckpoint {
  id: string
  /** Optional user-facing name ("before deploy", …). */
  name?: string
  /** Events with `seq <= checkpoint.seq` are included in the snapshot. */
  seq: number
  timestamp: string
  eventCount: number
  metrics?: AgentRunMetrics
}

/** Metadata describing how this run was forked from another run. */
export interface AgentRunBranchMeta {
  id: string
  label: string
  parentRunId: string
  /** `seq` in the parent run where the fork happened. */
  forkedAtSeq: number
  forkedAtEventId?: string
  createdAt: string
}

export interface AgentRun {
  id: string
  title: string
  prompt: string
  model: string
  status: AgentRunStatus
  events: AgentRunEvent[]
  metrics: AgentRunMetrics
  checkpoints: AgentRunCheckpoint[]
  branch?: AgentRunBranchMeta
  /** Ids of the two runs this one was merged from, when applicable. */
  mergedFrom?: string[]
  createdAt: string
  updatedAt: string
}

/* ------------------------------------------------------------------------ */
/* Small helpers shared across modules                                       */
/* ------------------------------------------------------------------------ */

let counter = 0

/** Monotonic-ish id generator; tests may reset via `resetRunIdCounter`. */
export function nextRunId(prefix = "run"): string {
  counter += 1
  return `${prefix}_${Date.now().toString(36)}_${counter.toString(36)}`
}

/** Test hook — resets the id counter between tests. */
export function resetRunIdCounter() {
  counter = 0
}

export function nowIso(): string {
  return new Date().toISOString()
}

export const TERMINAL_RUN_STATUSES: readonly AgentRunStatus[] = ["completed", "failed", "cancelled"]

export function isTerminalRunStatus(status: AgentRunStatus): boolean {
  return TERMINAL_RUN_STATUSES.includes(status)
}

/** Derive a run's status from its event log when no explicit status exists. */
export function deriveRunStatus(run: Pick<AgentRun, "status" | "events">): AgentRunStatus {
  if (run.status !== "running" && run.status !== "pending" && run.status !== "queued") {
    return run.status
  }
  const last = run.events[run.events.length - 1]
  if (!last) return "pending"
  if (last.type === "error" || last.status === "error") return "failed"
  if (last.type === "status" && last.summary === "done") return "completed"
  if (last.type === "status" && last.summary === "cancelled") return "cancelled"
  return "running"
}
