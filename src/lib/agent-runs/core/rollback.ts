/**
 * Run rollback (task 86).
 *
 * Restores a run to a checkpoint: events after the checkpoint seq are
 * truncated, metrics are recomputed, and the run records where it was rolled
 * back from/to. Original checkpoints are preserved so the timeline remains
 * navigable; a `checkpoint` marker event is appended to the log.
 */

import { computeRunMetrics } from "./cost"
import { findCheckpoint, eventsUpToSeq } from "./checkpoints"
import type { AgentRun, AgentRunCheckpoint, AgentRunEvent } from "./types"
import { deriveRunStatus, nextRunId, nowIso } from "./types"

export interface RollbackResult {
  run: AgentRun
  checkpoint: AgentRunCheckpoint
  /** Number of events truncated by the rollback. */
  truncatedEvents: number
}

export class RollbackError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "RollbackError"
  }
}

/**
 * Restore `run` to `checkpointId` (or a raw seq via `atSeq`). Returns a new
 * run — the input is never mutated.
 *
 * - Events with `seq > checkpoint.seq` are dropped.
 * - A `checkpoint`-type marker event records the rollback in the log.
 * - `status`: an explicit `target.status` wins. Otherwise the run's prior
 *   status is preserved when it is terminal (`completed`/`failed`/`cancelled`)
 *   — a finished run stays finished after rewind. For active statuses
 *   (`pending`/`queued`/`running`) the status is re-derived from the
 *   truncated log, which yields `running` (the marker event is not terminal).
 * - All checkpoints are kept; the rolled-back run gets `rolledBackTo` /
 *   `rolledBackFromSeq` annotations in `metrics`-adjacent metadata on the
 *   marker event payload.
 */
export function rollbackRun(
  run: AgentRun,
  target: { checkpointId?: string; atSeq?: number; status?: AgentRun["status"] },
): RollbackResult {
  let checkpointSeq: number
  let checkpoint: AgentRunCheckpoint | null = null

  if (target.checkpointId) {
    checkpoint = findCheckpoint(run, target.checkpointId)
    if (!checkpoint) {
      throw new RollbackError(`Checkpoint ${target.checkpointId} not found on run ${run.id}`)
    }
    checkpointSeq = checkpoint.seq
  } else if (typeof target.atSeq === "number") {
    checkpointSeq = target.atSeq
  } else {
    throw new RollbackError("rollbackRun requires checkpointId or atSeq")
  }

  const kept = eventsUpToSeq(run.events, checkpointSeq)
  const truncatedCount = run.events.length - kept.length
  const lastKeptSeq = kept.length > 0 ? kept[kept.length - 1].seq : 0

  const marker: AgentRunEvent = {
    id: nextRunId("evt_rollback"),
    seq: lastKeptSeq + 1,
    timestamp: nowIso(),
    type: "checkpoint",
    name: "rollback",
    summary: checkpoint?.name
      ? `Rolled back to checkpoint "${checkpoint.name}"`
      : `Rolled back to seq ${checkpointSeq}`,
    payload: {
      checkpointId: checkpoint?.id ?? null,
      checkpointSeq,
      truncatedEvents: truncatedCount,
      rolledBackFromSeq: run.events.length > 0 ? run.events[run.events.length - 1].seq : 0,
    },
    status: "ok",
  }

  const events = [...kept, marker]
  // deriveRunStatus returns terminal statuses unchanged, so a completed/
  // failed/cancelled run keeps its status; active runs derive "running"
  // from the truncated log + marker.
  const status = target.status ?? deriveRunStatus({ status: run.status, events })

  const rolledBack: AgentRun = {
    ...run,
    status,
    events,
    metrics: computeRunMetrics({ ...run, events }),
    updatedAt: nowIso(),
  }

  return {
    run: rolledBack,
    checkpoint: checkpoint ?? {
      id: `seq_${checkpointSeq}`,
      seq: checkpointSeq,
      timestamp: nowIso(),
      eventCount: kept.length,
    },
    truncatedEvents: truncatedCount,
  }
}

/** True when the run's latest marker event is a rollback. */
export function isRolledBack(run: Pick<AgentRun, "events">): boolean {
  const last = run.events[run.events.length - 1]
  return last?.type === "checkpoint" && last.name === "rollback"
}

/** Find the rollback marker event, if any. */
export function rollbackMarker(run: Pick<AgentRun, "events">): AgentRunEvent | null {
  for (let i = run.events.length - 1; i >= 0; i -= 1) {
    const event = run.events[i]
    if (event.type === "checkpoint" && event.name === "rollback") return event
  }
  return null
}
