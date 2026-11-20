/**
 * Run parallelization (task 83).
 *
 * Splits a recorded run's event log into independent branches ("lanes"), runs
 * them through a mock-parallel scheduler with a concurrency limit, and merges
 * the results back into a single ordered run. Everything here is deterministic
 * and side-effect free — the "execution" is simulated from recorded events.
 */

import { estimateTokens } from "./cost"
import { hashString } from "./hash"
import type { AgentRun, AgentRunEvent, AgentRunMetrics } from "./types"
import { nextRunId, nowIso } from "./types"

/* ------------------------------------------------------------------------ */
/* Branch planning                                                           */
/* ------------------------------------------------------------------------ */

export interface RunBranchPlan {
  id: string
  label: string
  /** Lane key events were grouped by. */
  lane: string
  events: AgentRunEvent[]
  /** Index of this branch's first event in the original run. */
  firstIndex: number
}

/**
 * Group a run's events into independent branches. Lane resolution order:
 * explicit `event.lane`, then `payload.branch` (string), then the first
 * segment of `event.name` (`research.fetch` → `research`). Events that don't
 * fit any step name collapse into a "main" lane.
 */
export function planRunBranches(
  run: Pick<AgentRun, "events">,
  options: { maxBranches?: number } = {},
): RunBranchPlan[] {
  const maxBranches = Math.max(1, options.maxBranches ?? 8)
  // lane -> items in original order, tracking source index so the catch-all
  // "other" lane can merge overflow lanes back in event order.
  const groups = new Map<string, { event: AgentRunEvent; index: number }[]>()
  const firstIndex = new Map<string, number>()

  run.events.forEach((event, index) => {
    const lane = laneForEvent(event)
    if (!groups.has(lane)) {
      groups.set(lane, [])
      firstIndex.set(lane, index)
    }
    groups.get(lane)!.push({ event, index })
  })

  const sorted = [...groups.entries()].sort(
    (a, b) => (firstIndex.get(a[0]) ?? 0) - (firstIndex.get(b[0]) ?? 0),
  )

  // Lanes past the cap are NOT dropped — they fold into a catch-all "other"
  // lane so no events are lost. `maxBranches - 1` real lanes are kept so the
  // catch-all itself counts toward the cap.
  const kept = sorted.slice(0, maxBranches - 1)
  const overflow = sorted.slice(maxBranches - 1)
  const lanes: [string, { event: AgentRunEvent; index: number }[]][] = [...kept]
  if (overflow.length > 0) {
    const otherItems = overflow.flatMap(([, items]) => items).sort((a, b) => a.index - b.index)
    lanes.push(["other", otherItems])
    firstIndex.set("other", Math.min(...overflow.map(([, items]) => items[0]?.index ?? 0)))
  }

  return lanes.map(([lane, items]) => ({
    id: `branch_${lane}`,
    label: lane,
    lane,
    events: items.map((i) => i.event),
    firstIndex: firstIndex.get(lane) ?? 0,
  }))
}

function laneForEvent(event: AgentRunEvent): string {
  if (event.lane) return event.lane
  const branch = event.payload?.branch
  if (typeof branch === "string" && branch.length > 0) return branch
  const segment = event.name.split(/[./:]/)[0]
  return segment && segment.length > 0 ? segment : "main"
}

/* ------------------------------------------------------------------------ */
/* Mock-parallel scheduler                                                   */
/* ------------------------------------------------------------------------ */

export interface ParallelTask<T> {
  id: string
  /** Work to execute; receives the task and an abort-ish signal object. */
  run: (signal: { cancelled: boolean }) => Promise<T> | T
}

export interface ParallelSchedulerOptions {
  /** Max tasks in flight. Default 4. */
  concurrency?: number
}

export interface ParallelTaskResult<T> {
  id: string
  /** Original task index — used to restore deterministic ordering. */
  index: number
  result?: T
  error?: string
  startedAt: string
  finishedAt: string
}

/**
 * Execute tasks with a bounded-concurrency scheduler. Results are returned in
 * *completion* order is NOT guaranteed — callers should sort by `index` (see
 * `orderParallelResults`) when deterministic output matters.
 */
export async function runParallelMock<T>(
  tasks: readonly ParallelTask<T>[],
  options: ParallelSchedulerOptions = {},
): Promise<ParallelTaskResult<T>[]> {
  const concurrency = Math.max(1, options.concurrency ?? 4)
  const results: ParallelTaskResult<T>[] = new Array(tasks.length)
  let cursor = 0

  async function worker() {
    for (;;) {
      const index = cursor
      cursor += 1
      if (index >= tasks.length) return
      const task = tasks[index]
      const signal = { cancelled: false }
      const startedAt = nowIso()
      try {
        const result = await task.run(signal)
        results[index] = {
          id: task.id,
          index,
          result,
          startedAt,
          finishedAt: nowIso(),
        }
      } catch (error) {
        results[index] = {
          id: task.id,
          index,
          error: error instanceof Error ? error.message : String(error),
          startedAt,
          finishedAt: nowIso(),
        }
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker())
  await Promise.all(workers)
  return results.filter((r): r is ParallelTaskResult<T> => r !== undefined)
}

/** Restore deterministic ordering: sort results by original task index. */
export function orderParallelResults<T>(
  results: readonly ParallelTaskResult<T>[],
): ParallelTaskResult<T>[] {
  return [...results].sort((a, b) => a.index - b.index)
}

/* ------------------------------------------------------------------------ */
/* Simulated branch execution                                                */
/* ------------------------------------------------------------------------ */

export interface SimulatedBranchResult {
  plan: RunBranchPlan
  /** Events the "execution" produced (mock: echoes inputs with new seqs). */
  events: AgentRunEvent[]
  metrics: AgentRunMetrics
  durationMs: number
}

export interface SimulateOptions extends ParallelSchedulerOptions {
  /** Simulated per-branch latency in ms. Default 0 (instant in tests). */
  latencyMs?: number
}

/**
 * Mock-execute branch plans in parallel. Each branch "runs" by re-emitting
 * its events (prefixed summaries) after an optional simulated latency, then
 * results are merged back into one ordered event log.
 */
export async function simulateRunBranches(
  run: AgentRun,
  options: SimulateOptions = {},
): Promise<{ run: AgentRun; branches: SimulatedBranchResult[] }> {
  const plans = planRunBranches(run)
  const latencyMs = options.latencyMs ?? 0

  const tasks: ParallelTask<SimulatedBranchResult>[] = plans.map((plan) => ({
    id: plan.id,
    run: async () => {
      if (latencyMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, latencyMs))
      }
      // seq is assigned by mergeBranchResults — don't pre-compute it here
      // (event seqs are not guaranteed contiguous).
      const events: AgentRunEvent[] = plan.events.map((event) => ({
        ...event,
        id: `${event.id}__sim_${plan.lane}`,
        summary: `[${plan.label}] ${event.summary ?? event.name}`,
      }))
      const tokens = plan.events.reduce((sum, e) => sum + (e.tokens ?? estimateTokens(e.name)), 0)
      return {
        plan,
        events,
        metrics: {
          steps: plan.events.length,
          totalTokens: tokens,
          durationMs: latencyMs,
        },
        durationMs: latencyMs,
      }
    },
  }))

  const results = orderParallelResults(await runParallelMock(tasks, options))
  const merged = mergeBranchResults(run, results)
  return { run: merged, branches: results.map((r) => r.result!) }
}

/**
 * Merge simulated branch outputs into a single run. Events are ordered by
 * their original position in the source run (stable), with each branch's
 * simulated events appended in plan order. Returns a new run object.
 */
export function mergeBranchResults(
  run: AgentRun,
  results: readonly ParallelTaskResult<SimulatedBranchResult>[],
): AgentRun {
  const simulated = results
    .filter((r) => r.result)
    .map((r) => r.result!)
    .sort((a, b) => a.plan.firstIndex - b.plan.firstIndex)

  const events: AgentRunEvent[] = [...run.events]
  // Continue from the last event's seq — seqs are not guaranteed contiguous.
  let seq = run.events.length > 0 ? run.events[run.events.length - 1].seq : 0
  for (const branch of simulated) {
    for (const event of branch.events) {
      seq += 1
      events.push({ ...event, seq })
    }
  }

  const totalTokens = simulated.reduce(
    (sum, b) => sum + (b.metrics.totalTokens ?? 0),
    run.metrics.totalTokens ?? 0,
  )

  return {
    ...run,
    id: nextRunId("run_sim"),
    status: "completed",
    events,
    metrics: {
      ...run.metrics,
      totalTokens,
      steps: events.filter((e) => e.type === "step" || e.type === "tool").length,
      durationMs: Math.max(run.metrics.durationMs ?? 0, ...simulated.map((b) => b.durationMs)),
    },
    updatedAt: nowIso(),
  }
}

/** Deterministic seed string for a run — handy for reproducible simulations. */
export function runSimulationSeed(run: Pick<AgentRun, "id" | "prompt">): string {
  return hashString(`${run.id}:${run.prompt}`)
}
