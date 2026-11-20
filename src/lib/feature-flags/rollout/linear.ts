import { clampPercent, inCohort } from "./hash"
import type { EvaluationContext, StrategyFn, StrategyOutcome } from "./types"

/**
 * Linear ramp: the enabled percentage grows linearly between two points in
 * time, then the cohort hash decides who is inside that percentage.
 *
 * Config:
 * ```ts
 * {
 *   startAt: string            // ISO 8601 timestamp
 *   endAt: string              // ISO 8601 timestamp (must be > startAt)
 *   startPercent?: number      // default 0 — percent at/before startAt
 *   endPercent?: number        // default 100 — percent at/after endAt
 *   salt?: string              // extra entropy for cohort bucketing
 * }
 * ```
 *
 * Before `startAt` the effective percent is `startPercent`, after `endAt` it
 * is `endPercent`, and in between it interpolates linearly:
 *
 *     percent(t) = start + (end - start) * (t - startAt) / (endAt - startAt)
 *
 * Like the percentage strategy, `ctx.cohort`/attributes decide who is in the
 * ramp at each point, so the rollout widens smoothly without re-bucketing
 * users already enabled (buckets below the current percent stay enabled).
 */
export interface LinearConfig {
  startAt: string
  endAt: string
  startPercent?: number
  endPercent?: number
  salt?: string
}

function parseConfig(config: unknown): { cfg: LinearConfig; startMs: number; endMs: number } {
  if (typeof config !== "object" || config === null) {
    throw new TypeError("linear strategy requires a config object")
  }
  const raw = config as Record<string, unknown>
  if (typeof raw.startAt !== "string" || typeof raw.endAt !== "string") {
    throw new TypeError("linear strategy requires `startAt` and `endAt` ISO timestamps")
  }
  const startMs = Date.parse(raw.startAt)
  const endMs = Date.parse(raw.endAt)
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
    throw new TypeError("linear strategy `startAt`/`endAt` must be valid ISO timestamps")
  }
  if (endMs <= startMs) {
    throw new TypeError("linear strategy requires `endAt` after `startAt`")
  }

  const cfg: LinearConfig = {
    startAt: raw.startAt,
    endAt: raw.endAt,
    startPercent: typeof raw.startPercent === "number" ? clampPercent(raw.startPercent) : 0,
    endPercent: typeof raw.endPercent === "number" ? clampPercent(raw.endPercent) : 100,
    salt: typeof raw.salt === "string" ? raw.salt : undefined,
  }
  return { cfg, startMs, endMs }
}

/** Effective rollout percentage at `now`, clamped to [0, 100]. */
export function linearPercentAt(
  cfg: LinearConfig,
  now: Date,
  startMs?: number,
  endMs?: number,
): number {
  const start = startMs ?? Date.parse(cfg.startAt)
  const end = endMs ?? Date.parse(cfg.endAt)
  const t = now.getTime()
  if (t <= start) return clampPercent(cfg.startPercent ?? 0)
  if (t >= end) return clampPercent(cfg.endPercent ?? 100)
  const startPct = cfg.startPercent ?? 0
  const endPct = cfg.endPercent ?? 100
  const ratio = (t - start) / (end - start)
  return clampPercent(startPct + (endPct - startPct) * ratio)
}

function run(config: unknown, ctx: EvaluationContext, now: Date): StrategyOutcome {
  const { cfg, startMs, endMs } = parseConfig(config)
  const percent = linearPercentAt(cfg, now, startMs, endMs)
  const enabled = inCohort(ctx, percent, cfg.salt)
  const phase =
    now.getTime() <= startMs
      ? "before ramp start"
      : now.getTime() >= endMs
        ? "after ramp end"
        : "mid-ramp"
  return {
    verdict: enabled,
    reason: `${phase}: effective rollout ${percent.toFixed(2)}%, cohort ${enabled ? "in" : "out"}`,
  }
}

export const linearStrategy: StrategyFn = (config, ctx, now) => run(config, ctx, now)
