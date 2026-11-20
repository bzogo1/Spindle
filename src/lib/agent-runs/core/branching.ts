/**
 * Run branching (task 87).
 *
 * Fork a run at a checkpoint or event seq into a divergent branch: the branch
 * keeps the shared prefix, gets its own id/label/metadata, and accumulates
 * its own event tail. `branchEvents` exposes the divergent portion for diff
 * and merge operations.
 */

import { computeRunMetrics } from "./cost"
import { eventsAfterSeq, eventsUpToSeq, findCheckpoint } from "./checkpoints"
import type { AgentRun, AgentRunBranchMeta, AgentRunEvent } from "./types"
import { nextRunId, nowIso } from "./types"

export interface CreateBranchOptions {
  /** Fork after this seq (inclusive). Defaults to the run's current end. */
  atSeq?: number
  /** Fork after the event with this id — resolved to its seq. */
  atEventId?: string
  /** Fork after this named checkpoint. */
  checkpointId?: string
  /** Human label shown in branch pickers. */
  label?: string
  /** Branch id override; auto-generated otherwise. */
  id?: string
}

export class BranchError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "BranchError"
  }
}

/**
 * Create a branch of `run`. The branch is a new `AgentRun` whose events are
 * the parent's prefix up to the fork point; subsequent events appended to the
 * branch are its divergent log. Branch metadata links back to the parent.
 */
export function createBranch(run: AgentRun, options: CreateBranchOptions = {}): AgentRun {
  let forkSeq: number

  if (options.checkpointId) {
    const checkpoint = findCheckpoint(run, options.checkpointId)
    if (!checkpoint) throw new BranchError(`Checkpoint ${options.checkpointId} not found`)
    forkSeq = checkpoint.seq
  } else if (options.atEventId) {
    const event = run.events.find((e) => e.id === options.atEventId)
    if (!event) throw new BranchError(`Event ${options.atEventId} not found`)
    forkSeq = event.seq
  } else if (typeof options.atSeq === "number") {
    forkSeq = options.atSeq
  } else {
    forkSeq = run.events.length > 0 ? run.events[run.events.length - 1].seq : 0
  }

  if (forkSeq < 0) throw new BranchError("Fork seq cannot be negative")

  const prefix = eventsUpToSeq(run.events, forkSeq)
  const forkEvent = [...run.events].reverse().find((e) => e.seq <= forkSeq)

  const branchMeta: AgentRunBranchMeta = {
    id: options.id ?? nextRunId("branch"),
    label: options.label ?? `Branch of ${run.id}`,
    parentRunId: run.id,
    forkedAtSeq: forkSeq,
    ...(forkEvent ? { forkedAtEventId: forkEvent.id } : {}),
    createdAt: nowIso(),
  }

  const branch: AgentRun = {
    ...run,
    id: nextRunId("run_branch"),
    title: `${run.title} (${branchMeta.label})`,
    status: "running",
    events: [...prefix],
    metrics: computeRunMetrics({ ...run, events: prefix }),
    checkpoints: run.checkpoints.filter((c) => c.seq <= forkSeq),
    branch: branchMeta,
    mergedFrom: undefined,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  }

  return branch
}

/**
 * Append an event to a branch run. The event is stamped with the branch id
 * and the next seq, and the run's metrics/status are refreshed.
 */
export function appendBranchEvent(
  branch: AgentRun,
  event: Omit<AgentRunEvent, "seq" | "branchId"> & { seq?: number },
): AgentRun {
  const seq = event.seq ?? nextSeq(branch.events)
  const stamped: AgentRunEvent = {
    ...event,
    seq,
    branchId: branch.branch?.id ?? branch.id,
  }
  const events = [...branch.events, stamped]
  return {
    ...branch,
    events,
    metrics: computeRunMetrics({ ...branch, events }),
    updatedAt: nowIso(),
  }
}

/** The divergent tail of a branch — events after the fork point. */
export function branchEvents(branch: AgentRun): AgentRunEvent[] {
  if (!branch.branch) return [...branch.events]
  return eventsAfterSeq(branch.events, branch.branch.forkedAtSeq)
}

/** Shared prefix between a branch and its parent (events up to fork seq). */
export function sharedPrefix(branch: AgentRun): AgentRunEvent[] {
  if (!branch.branch) return []
  return eventsUpToSeq(branch.events, branch.branch.forkedAtSeq)
}

export function isBranch(run: AgentRun): boolean {
  return run.branch !== undefined
}

export function branchLabel(run: AgentRun): string | null {
  return run.branch?.label ?? null
}

function nextSeq(events: readonly AgentRunEvent[]): number {
  return events.length > 0 ? events[events.length - 1].seq + 1 : 1
}
