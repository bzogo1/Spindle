/**
 * Run checkpoints (task 85).
 *
 * Snapshots of run state at points in the event log: automatic interval
 * snapshots plus named checkpoints. Checkpoints store enough state (seq,
 * event count, metrics) to roll back to or branch from later.
 */

import { computeRunMetrics } from "./cost"
import type { AgentRun, AgentRunCheckpoint, AgentRunEvent } from "./types"
import { nextRunId, nowIso } from "./types"

export interface CheckpointOptions {
  name?: string
  /** Take the snapshot at this seq; defaults to the current end of the log. */
  seq?: number
  timestamp?: string
}

/**
 * Snapshot a run at `seq` (default: latest event). Metrics are recomputed
 * from the truncated log so the checkpoint is self-contained.
 */
export function createCheckpoint(
  run: AgentRun,
  options: CheckpointOptions = {},
): AgentRunCheckpoint {
  const events = eventsUpToSeq(run.events, options.seq ?? lastSeq(run.events))
  const truncated: AgentRun = { ...run, events }
  return {
    id: nextRunId("ckpt"),
    ...(options.name ? { name: options.name } : {}),
    seq: events.length > 0 ? events[events.length - 1].seq : 0,
    timestamp: options.timestamp ?? nowIso(),
    eventCount: events.length,
    metrics: computeRunMetrics(truncated),
  }
}

/** Return a new run with the checkpoint appended (immutable update). */
export function addCheckpoint(run: AgentRun, checkpoint: AgentRunCheckpoint): AgentRun {
  return {
    ...run,
    checkpoints: [...run.checkpoints, checkpoint],
    updatedAt: nowIso(),
  }
}

/** Convenience: snapshot + attach in one call. */
export function checkpointRun(run: AgentRun, options: CheckpointOptions = {}): AgentRun {
  return addCheckpoint(run, createCheckpoint(run, options))
}

/** Attach a user-facing name to an existing checkpoint. */
export function nameCheckpoint(run: AgentRun, checkpointId: string, name: string): AgentRun {
  return {
    ...run,
    checkpoints: run.checkpoints.map((c) => (c.id === checkpointId ? { ...c, name } : c)),
  }
}

/** Checkpoints sorted by seq ascending — the timeline order. */
export function listCheckpoints(run: Pick<AgentRun, "checkpoints">): AgentRunCheckpoint[] {
  return [...run.checkpoints].sort((a, b) => a.seq - b.seq)
}

export function findCheckpoint(
  run: Pick<AgentRun, "checkpoints">,
  checkpointId: string,
): AgentRunCheckpoint | null {
  return run.checkpoints.find((c) => c.id === checkpointId) ?? null
}

/** Events included in a checkpoint's snapshot. */
export function checkpointEvents(
  run: Pick<AgentRun, "events">,
  checkpoint: AgentRunCheckpoint,
): AgentRunEvent[] {
  return eventsUpToSeq(run.events, checkpoint.seq)
}

/* ------------------------------------------------------------------------ */
/* Automatic interval checkpoints                                            */
/* ------------------------------------------------------------------------ */

export interface AutoCheckpointOptions {
  /** Take a checkpoint every N events. Mutually exclusive with `everyMs`. */
  everyEvents?: number
  /** Take a checkpoint every N milliseconds of run time (by timestamps). */
  everyMs?: number
  /** Prefix for auto-generated checkpoint names. */
  namePrefix?: string
}

/**
 * Generate checkpoints at regular intervals across the run's event log.
 * With `everyEvents`, a checkpoint is emitted after every Nth event; with
 * `everyMs`, one checkpoint per interval boundary crossed — an event whose
 * timestamp jumps multiple intervals produces multiple snapshots anchored to
 * that event (intermediate states were never recorded).
 */
export function autoCheckpoints(
  run: AgentRun,
  options: AutoCheckpointOptions,
): AgentRunCheckpoint[] {
  const checkpoints: AgentRunCheckpoint[] = []
  const prefix = options.namePrefix ?? "auto"

  if (options.everyEvents && options.everyEvents > 0) {
    const step = options.everyEvents
    for (let i = step; i <= run.events.length; i += step) {
      const event = run.events[i - 1]
      checkpoints.push({
        id: nextRunId("ckpt_auto"),
        name: `${prefix} @ event ${i}`,
        seq: event.seq,
        timestamp: event.timestamp,
        eventCount: i,
        metrics: computeRunMetrics({ ...run, events: run.events.slice(0, i) }),
      })
    }
    return checkpoints
  }

  if (options.everyMs && options.everyMs > 0 && run.events.length > 0) {
    const everyMs = options.everyMs
    const first = Date.parse(run.events[0].timestamp)
    if (Number.isNaN(first)) return checkpoints
    let nextBoundary = first + everyMs
    run.events.forEach((event, index) => {
      const t = Date.parse(event.timestamp)
      if (Number.isNaN(t)) return
      // Emit one checkpoint per crossed interval — an event far past
      // nextBoundary produces multiple snapshots (all anchored to this
      // event's seq/timestamp since intermediate states weren't recorded).
      // The iteration cap guards against pathological timestamp gaps.
      let guard = 0
      while (t >= nextBoundary && guard < 10_000) {
        guard += 1
        checkpoints.push({
          id: nextRunId("ckpt_auto"),
          name: `${prefix} @ ${new Date(nextBoundary).toISOString()}`,
          seq: event.seq,
          timestamp: event.timestamp,
          eventCount: index + 1,
          metrics: computeRunMetrics({
            ...run,
            events: run.events.slice(0, index + 1),
          }),
        })
        nextBoundary += everyMs
      }
    })
  }

  return checkpoints
}

/* ------------------------------------------------------------------------ */
/* Internals                                                                 */
/* ------------------------------------------------------------------------ */

function lastSeq(events: readonly AgentRunEvent[]): number {
  return events.length > 0 ? events[events.length - 1].seq : 0
}

/** Events with `seq <= maxSeq`, preserving order. */
export function eventsUpToSeq(events: readonly AgentRunEvent[], maxSeq: number): AgentRunEvent[] {
  return events.filter((e) => e.seq <= maxSeq)
}

/** Events with `seq > minSeq` — the divergent tail after a fork point. */
export function eventsAfterSeq(events: readonly AgentRunEvent[], minSeq: number): AgentRunEvent[] {
  return events.filter((e) => e.seq > minSeq)
}
