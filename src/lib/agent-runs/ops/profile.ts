/**
 * Agent run profiling — per-step timing breakdown and bottleneck detection.
 *
 * `buildRunProfile` converts a run's steps into offsets relative to the run
 * start so a flame-bar visualization can render each step as a proportional
 * bar. `detectBottlenecks` ranks steps that dominate wall-clock time.
 */

import {
  runDurationMs,
  runStartIso,
  stepDurationMs,
  type AgentRunRecord,
  type AgentRunOpsStep,
} from "./types"

export interface StepProfile {
  stepId: string
  index: number
  kind: AgentRunOpsStep["kind"]
  title: string
  status: AgentRunOpsStep["status"]
  /** Offset from run start to step start (ms). */
  startOffsetMs: number
  /** Offset from run start to step end (ms). */
  endOffsetMs: number
  durationMs: number
  /** durationMs / total run duration (0..1), null when total is 0. */
  share: number | null
}

export interface RunProfile {
  runId: string
  /** Effective run duration used as the profile window (ms). */
  totalMs: number
  steps: StepProfile[]
  /** Steps skipped because timestamps were unparseable. */
  skippedSteps: number
  /** Aggregated duration per step kind. */
  byKind: Record<AgentRunOpsStep["kind"], number>
}

function parseMs(iso: string | undefined): number | null {
  if (!iso) return null
  const ms = new Date(iso).getTime()
  return Number.isNaN(ms) ? null : ms
}

export function buildRunProfile(run: AgentRunRecord, options: { now?: number } = {}): RunProfile {
  const now = options.now ?? Date.now()
  const totalMs = runDurationMs(run, now) ?? 0
  const runStartMs = parseMs(runStartIso(run)) ?? 0

  const steps: StepProfile[] = []
  const byKind: Record<AgentRunOpsStep["kind"], number> = {
    thought: 0,
    tool_call: 0,
    result: 0,
  }
  let skippedSteps = 0

  run.steps.forEach((step, index) => {
    const startMs = parseMs(step.startedAt)
    const duration = stepDurationMs(step)
    if (startMs === null || duration === null) {
      skippedSteps += 1
      return
    }
    const startOffsetMs = Math.max(0, startMs - runStartMs)
    const endOffsetMs = startOffsetMs + duration
    const share = totalMs > 0 ? duration / totalMs : null
    steps.push({
      stepId: step.id,
      index,
      kind: step.kind,
      title: step.title,
      status: step.status,
      startOffsetMs,
      endOffsetMs,
      durationMs: duration,
      share,
    })
    byKind[step.kind] += duration
  })

  return { runId: run.id, totalMs, steps, skippedSteps, byKind }
}

export interface Bottleneck {
  step: StepProfile
  durationMs: number
  /** Fraction of total run time consumed (0..1). */
  share: number
  reason: string
}

export interface BottleneckOptions {
  /** Minimum share of total time to flag (default 0.25). */
  shareThreshold?: number
  /** Absolute floor in ms — steps shorter than this are never flagged (default 500). */
  minDurationMs?: number
  /** Max bottlenecks returned (default 5). */
  limit?: number
}

/**
 * Rank steps that dominate run time. A step is a bottleneck when it consumes
 * at least `shareThreshold` of the total AND at least `minDurationMs`.
 */
export function detectBottlenecks(
  profile: RunProfile,
  options: BottleneckOptions = {},
): Bottleneck[] {
  const shareThreshold = options.shareThreshold ?? 0.25
  const minDurationMs = options.minDurationMs ?? 500
  const limit = options.limit ?? 5
  if (profile.totalMs <= 0) return []

  return profile.steps
    .filter((step) => {
      const share = step.durationMs / profile.totalMs
      return share >= shareThreshold && step.durationMs >= minDurationMs
    })
    .map((step) => ({
      step,
      durationMs: step.durationMs,
      share: step.durationMs / profile.totalMs,
      reason:
        step.kind === "tool_call"
          ? `Tool call consumed ${(step.share! * 100).toFixed(0)}% of run time`
          : `${step.kind} step consumed ${(step.share! * 100).toFixed(0)}% of run time`,
    }))
    .sort((a, b) => b.durationMs - a.durationMs)
    .slice(0, limit)
}

/**
 * Convert a profile into flame-bar rows for rendering: each step becomes a
 * positioned bar (`left%`/`width%` of the total window). Steps are sorted by
 * start offset so overlapping tool calls render in order.
 */
export function flameBarRows(profile: RunProfile): {
  step: StepProfile
  leftPct: number
  widthPct: number
}[] {
  if (profile.totalMs <= 0) return []
  const clampPct = (value: number) => Math.min(100, Math.max(0, value))
  return [...profile.steps]
    .sort((a, b) => a.startOffsetMs - b.startOffsetMs)
    .map((step) => {
      // Steps can overrun the profile window (e.g. a step outliving finishedAt);
      // clamp both edges to [0, 100] and keep the bar inside the track.
      const leftPct = clampPct((step.startOffsetMs / profile.totalMs) * 100)
      const rawWidth = (step.durationMs / profile.totalMs) * 100
      const available = Math.max(0, 100 - leftPct)
      const clampedWidth = Math.min(clampPct(rawWidth), available)
      // Keep a sliver visible for tiny-but-real steps, never past the track.
      const widthPct = clampedWidth > 0 ? Math.min(Math.max(clampedWidth, 0.5), available) : 0
      return { step, leftPct, widthPct }
    })
}
