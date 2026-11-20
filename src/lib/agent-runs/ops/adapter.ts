/**
 * Adapter from `core` run records (`src/lib/agent-runs/core/types.ts`) to ops
 * `AgentRunRecord`s.
 *
 * The two subsystems use different status enums and event shapes:
 *
 *   core `AgentRunStatus`        ops `AgentRunOpsStatus`
 *   ------------------------     ------------------------
 *   pending                      queued
 *   queued                       queued
 *   running                      running
 *   completed                    succeeded
 *   failed                       failed
 *   cancelled                    cancelled
 *   (none)                       waiting_approval
 *   (none)                       rejected
 *
 * Ops-only statuses (`waiting_approval`, `rejected`) have no core
 * equivalent — a core run awaiting approval is still `running` until core
 * grows the concept. Core `AgentRunEvent`s are mapped onto normalized
 * `AgentStreamEntry`s so ops tooling (debug, security, analytics) can
 * inspect them; unmapped event types degrade to `log` entries.
 */

import type { AgentRun, AgentRunEvent, AgentRunStatus } from "@/lib/agent-runs/core/types"
import type { AgentStreamEntry, AgentStreamKind, AgentStreamLevel } from "@/lib/agent-log-stream"

import { normalizeAgentRunRecord, type AgentRunOpsStatus, type AgentRunRecord } from "./types"

export function coreStatusToOpsStatus(status: AgentRunStatus): AgentRunOpsStatus {
  switch (status) {
    case "completed":
      return "succeeded"
    case "pending":
    case "queued":
      return "queued"
    case "running":
      return "running"
    case "failed":
      return "failed"
    case "cancelled":
      return "cancelled"
  }
}

const EVENT_KIND_MAP: Record<AgentRunEvent["type"], AgentStreamKind> = {
  step: "log",
  tool: "log",
  message: "log",
  approval: "approval_required",
  metric: "log",
  status: "status",
  checkpoint: "log",
  error: "error",
}

function eventLevel(event: AgentRunEvent): AgentStreamLevel {
  if (event.type === "error" || event.status === "error") return "error"
  if (event.status === "skipped") return "warn"
  return "info"
}

function coreEventToStreamEntry(event: AgentRunEvent): AgentStreamEntry {
  return {
    id: event.id,
    timestamp: event.timestamp,
    level: eventLevel(event),
    source: event.lane ?? "agent",
    kind: EVENT_KIND_MAP[event.type] ?? "log",
    message: event.summary ?? event.name,
    data: {
      name: event.name,
      ...(event.payload ?? {}),
      ...(event.tokens !== undefined ? { tokens: event.tokens } : {}),
      ...(event.durationMs !== undefined ? { durationMs: event.durationMs } : {}),
      ...(event.branchId ? { branchId: event.branchId } : {}),
    },
  }
}

/**
 * Convert a core `AgentRun` into an ops `AgentRunRecord`.
 *
 * - Status mapped per the table above.
 * - Core events become normalized stream entries (debug/security tooling).
 * - Core checkpoints become step-like records? No — ops steps are a separate
 *   concept; core runs expose `events` only, so `steps` stays empty and
 *   profiling falls back to event timings where available.
 * - `model`, `metrics`, `createdAt`/`updatedAt` carry over; `updatedAt` is
 *   used as `finishedAt` for terminal statuses.
 */
export function coreRunToOpsRecord(run: AgentRun): AgentRunRecord {
  const status = coreStatusToOpsStatus(run.status)
  const terminal = status === "succeeded" || status === "failed" || status === "cancelled"
  return normalizeAgentRunRecord({
    id: run.id,
    name: run.title,
    prompt: run.prompt,
    status,
    model: run.model,
    createdAt: run.createdAt,
    startedAt: run.createdAt,
    finishedAt: terminal ? run.updatedAt : undefined,
    steps: [],
    events: run.events.map(coreEventToStreamEntry),
    metrics: {
      model: run.model,
      durationMs: run.metrics.durationMs,
      inputTokens: run.metrics.inputTokens,
      outputTokens: run.metrics.outputTokens,
      totalTokens: run.metrics.totalTokens,
      costUsd: run.metrics.costUsd,
    },
    tags: [],
    summary: run.events[run.events.length - 1]?.summary,
  })
}
