/**
 * Run merging (task 88).
 *
 * Merges two divergent branches of a shared base run. Conflict detection keys
 * on event `name`: when both branches produced an event with the same name
 * but different content (per `eventContentHash`), it's a conflict. Identical
 * events are deduplicated, not conflicted.
 *
 * Strategies:
 *   - `ours`   — keep only our divergent events
 *   - `theirs` — keep only their divergent events
 *   - `union`  — keep all non-conflicting events from both; conflicts resolve
 *                to ours (or a per-conflict `resolve` callback)
 */

import { computeRunMetrics } from "./cost"
import { eventContentHash } from "./hash"
import { branchEvents } from "./branching"
import type { AgentRun, AgentRunEvent } from "./types"
import { nextRunId, nowIso } from "./types"

export type MergeStrategy = "ours" | "theirs" | "union"

export interface MergeConflict {
  /** Event name both branches produced. */
  key: string
  ours: AgentRunEvent
  theirs: AgentRunEvent
}

export interface MergeResult {
  run: AgentRun
  conflicts: MergeConflict[]
  /** Events contributed by each side (post-dedupe). */
  oursEvents: AgentRunEvent[]
  theirsEvents: AgentRunEvent[]
}

export interface MergeOptions {
  strategy?: MergeStrategy
  /**
   * Per-conflict resolver for `union` merges: return "ours" | "theirs" |
   * "both" | "skip". Defaults to "ours".
   */
  resolve?: (conflict: MergeConflict) => "ours" | "theirs" | "both" | "skip"
  /** Run id for the merged result. */
  id?: string
}

/**
 * The divergent events of a run relative to a base. For branches this is the
 * post-fork tail; for the base run itself it's the whole log.
 */
export function divergentEvents(run: AgentRun, base?: AgentRun): AgentRunEvent[] {
  if (run.branch) return branchEvents(run)
  if (base && base.events.length > 0) {
    const baseSeq = base.events[base.events.length - 1].seq
    return run.events.filter((e) => e.seq > baseSeq)
  }
  return [...run.events]
}

/**
 * Detect conflicts between two divergent event lists. Two events conflict
 * when they share a `name` but differ in content hash; same-name same-content
 * events are duplicates (deduped by the merger, not conflicts).
 */
export function detectMergeConflicts(
  ours: readonly AgentRunEvent[],
  theirs: readonly AgentRunEvent[],
): MergeConflict[] {
  const conflicts: MergeConflict[] = []
  const oursByName = new Map<string, AgentRunEvent[]>()
  for (const event of ours) {
    const list = oursByName.get(event.name) ?? []
    list.push(event)
    oursByName.set(event.name, list)
  }

  const matchedOurs = new Set<string>()
  for (const theirEvent of theirs) {
    const candidates = oursByName.get(theirEvent.name)
    if (!candidates) continue
    const match = candidates.find(
      (o) => !matchedOurs.has(o.id) && eventContentHash(o) === eventContentHash(theirEvent),
    )
    if (match) {
      matchedOurs.add(match.id)
      continue // identical — duplicate, not a conflict
    }
    const oursEvent = candidates.find((o) => !matchedOurs.has(o.id))
    if (oursEvent) {
      matchedOurs.add(oursEvent.id)
      conflicts.push({ key: theirEvent.name, ours: oursEvent, theirs: theirEvent })
    }
  }
  return conflicts
}

/**
 * Merge `ours` and `theirs` on top of `base`. Returns a new run plus the
 * conflict list. The merged event log is `base.events` + resolved divergent
 * events, renumbered sequentially.
 */
export function mergeRuns(
  base: AgentRun,
  ours: AgentRun,
  theirs: AgentRun,
  options: MergeOptions = {},
): MergeResult {
  const strategy = options.strategy ?? "union"
  const oursDiv = divergentEvents(ours, base)
  const theirsDiv = divergentEvents(theirs, base)
  const conflicts = detectMergeConflicts(oursDiv, theirsDiv)

  let mergedDiv: AgentRunEvent[]

  if (strategy === "ours") {
    mergedDiv = [...oursDiv]
  } else if (strategy === "theirs") {
    mergedDiv = [...theirsDiv]
  } else {
    // union: dedupe identical events, resolve conflicts per strategy.
    const seen = new Set<string>()
    const dedupe = (events: AgentRunEvent[]) =>
      events.filter((e) => {
        const sig = `${e.name}:${eventContentHash(e)}`
        if (seen.has(sig)) return false
        seen.add(sig)
        return true
      })

    const conflictByOursId = new Map(conflicts.map((c) => [c.ours.id, c]))
    const conflictedTheirsIds = new Set(conflicts.map((c) => c.theirs.id))

    const oursResolved: AgentRunEvent[] = []
    const theirsResolved: AgentRunEvent[] = []

    for (const event of oursDiv) {
      const conflict = conflictByOursId.get(event.id)
      if (!conflict) {
        oursResolved.push(event)
        continue
      }
      const decision = options.resolve?.(conflict) ?? "ours"
      if (decision === "ours" || decision === "both") oursResolved.push(event)
      if (decision === "theirs" || decision === "both") theirsResolved.push(conflict.theirs)
    }
    for (const event of theirsDiv) {
      if (conflictedTheirsIds.has(event.id)) continue // handled via conflict
      theirsResolved.push(event)
    }

    // Interleave by original seq for a stable, readable log.
    mergedDiv = [...oursResolved, ...theirsResolved].sort(
      (a, b) => a.seq - b.seq || a.id.localeCompare(b.id),
    )
    mergedDiv = dedupe(mergedDiv)
  }

  // Renumber merged events sequentially on top of the base.
  const events: AgentRunEvent[] = [...base.events]
  let seq = base.events.length > 0 ? base.events[base.events.length - 1].seq : 0
  for (const event of mergedDiv) {
    seq += 1
    events.push({ ...event, seq })
  }

  const merged: AgentRun = {
    ...base,
    id: options.id ?? nextRunId("run_merged"),
    title: `${base.title} (merged)`,
    status: "completed",
    events,
    metrics: computeRunMetrics({ ...base, events }),
    mergedFrom: [ours.id, theirs.id],
    // Copy the array — sharing the reference would let callers mutate the
    // base run's checkpoints through the merged run.
    checkpoints: [...base.checkpoints],
    createdAt: nowIso(),
    updatedAt: nowIso(),
  }

  return {
    run: merged,
    conflicts,
    oursEvents: oursDiv,
    theirsEvents: theirsDiv,
  }
}

/** Serialize a merge result for export — JSON with conflicts embedded. */
export function exportMergedRun(result: MergeResult, pretty = true): string {
  return JSON.stringify(
    {
      run: result.run,
      conflicts: result.conflicts.map((c) => ({
        key: c.key,
        oursEventId: c.ours.id,
        theirsEventId: c.theirs.id,
      })),
      exportedAt: nowIso(),
    },
    null,
    pretty ? 2 : 0,
  )
}

/** Serialize just the merged run (no conflict metadata). */
export function exportRun(run: AgentRun, pretty = true): string {
  return JSON.stringify(run, null, pretty ? 2 : 0)
}
