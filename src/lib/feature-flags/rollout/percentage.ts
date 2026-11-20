import { clampPercent, inCohort } from "./hash"
import type { EvaluationContext, StrategyFn, StrategyOutcome } from "./types"

/**
 * Percentage-based rollout: a stable share of the cohort gets the flag.
 *
 * Config:
 * ```ts
 * { percent: number, salt?: string }
 * ```
 *
 * `percent` is clamped to [0, 100]. Identity comes from `ctx.cohort` (or the
 * `userId`/`id` attributes, or the shared "anonymous" bucket) and is hashed
 * together with `ctx.flagKey` and `salt`, so bucketing is deterministic per
 * flag and independent across flags.
 */
export interface PercentageConfig {
  percent: number
  salt?: string
}

function parseConfig(config: unknown): PercentageConfig {
  if (typeof config !== "object" || config === null) {
    throw new TypeError("percentage strategy requires a config object")
  }
  const { percent, salt } = config as Record<string, unknown>
  if (typeof percent !== "number") {
    throw new TypeError("percentage strategy requires a numeric `percent`")
  }
  return { percent: clampPercent(percent), salt: typeof salt === "string" ? salt : undefined }
}

function run(config: unknown, ctx: EvaluationContext): StrategyOutcome {
  const { percent, salt } = parseConfig(config)
  const enabled = inCohort(ctx, percent, salt)
  return {
    verdict: enabled,
    reason: enabled
      ? `cohort bucket inside ${percent}% rollout`
      : `cohort bucket outside ${percent}% rollout`,
  }
}

export const percentageStrategy: StrategyFn = (config, ctx, _now) => run(config, ctx)
