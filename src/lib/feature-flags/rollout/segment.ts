import { clampPercent, inCohort, resolveCohortIdentity } from "./hash"
import type { EvaluationContext, FlagAttributeValue, StrategyFn, StrategyOutcome } from "./types"

/**
 * User-segment rollout: enable the flag for a defined slice of users.
 *
 * Config — every field is optional, but at least one criterion should be
 * provided (an empty config abstains):
 * ```ts
 * {
 *   plans?: string[]            // ctx.plan must be one of these
 *   envs?: string[]             // ctx.env must be one of these
 *   cohorts?: string[]          // ctx.cohort (or identity) must be listed
 *   cohortPercent?: number      // gradual cohort rollout via stable hash
 *   attributes?: Record<string, FlagAttributeValue[]>  // attr → allowed values
 *   salt?: string               // extra entropy for cohortPercent bucketing
 * }
 * ```
 *
 * All provided criteria must match (logical AND). `cohortPercent` reuses the
 * same deterministic hash as the percentage strategy, so a user is either in
 * or out consistently.
 */
export interface SegmentConfig {
  plans?: readonly string[]
  envs?: readonly string[]
  cohorts?: readonly string[]
  cohortPercent?: number
  attributes?: Record<string, readonly FlagAttributeValue[]>
  salt?: string
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string")
}

function parseConfig(config: unknown): SegmentConfig {
  if (typeof config !== "object" || config === null) {
    throw new TypeError("segment strategy requires a config object")
  }
  const raw = config as Record<string, unknown>
  const result: SegmentConfig = {}

  if (raw.plans !== undefined) {
    if (!isStringArray(raw.plans)) throw new TypeError("segment `plans` must be string[]")
    result.plans = raw.plans
  }
  if (raw.envs !== undefined) {
    if (!isStringArray(raw.envs)) throw new TypeError("segment `envs` must be string[]")
    result.envs = raw.envs
  }
  if (raw.cohorts !== undefined) {
    if (!isStringArray(raw.cohorts)) throw new TypeError("segment `cohorts` must be string[]")
    result.cohorts = raw.cohorts
  }
  if (raw.cohortPercent !== undefined) {
    if (typeof raw.cohortPercent !== "number") {
      throw new TypeError("segment `cohortPercent` must be a number")
    }
    result.cohortPercent = clampPercent(raw.cohortPercent)
  }
  if (raw.salt !== undefined && typeof raw.salt !== "string") {
    throw new TypeError("segment `salt` must be a string")
  }
  result.salt = raw.salt as string | undefined

  if (raw.attributes !== undefined) {
    if (typeof raw.attributes !== "object" || raw.attributes === null) {
      throw new TypeError("segment `attributes` must be an object of allowed values")
    }
    const attributes: Record<string, readonly FlagAttributeValue[]> = {}
    for (const [key, allowed] of Object.entries(raw.attributes)) {
      if (!Array.isArray(allowed)) {
        throw new TypeError(`segment attribute "${key}" must map to an array`)
      }
      attributes[key] = allowed as readonly FlagAttributeValue[]
    }
    result.attributes = attributes
  }

  return result
}

function run(config: unknown, ctx: EvaluationContext): StrategyOutcome {
  const cfg = parseConfig(config)
  const failures: string[] = []

  const hasCriteria =
    cfg.plans !== undefined ||
    cfg.envs !== undefined ||
    cfg.cohorts !== undefined ||
    cfg.cohortPercent !== undefined ||
    cfg.attributes !== undefined

  if (!hasCriteria) {
    return { verdict: null, reason: "segment strategy has no criteria configured" }
  }

  if (cfg.plans !== undefined && !(ctx.plan != null && cfg.plans.includes(ctx.plan))) {
    failures.push(`plan "${ctx.plan ?? "∅"}" not in [${cfg.plans.join(", ")}]`)
  }
  if (cfg.envs !== undefined && !(ctx.env != null && cfg.envs.includes(ctx.env))) {
    failures.push(`env "${ctx.env ?? "∅"}" not in [${cfg.envs.join(", ")}]`)
  }
  if (cfg.cohorts !== undefined) {
    const identity = resolveCohortIdentity(ctx)
    if (identity === "anonymous" || !cfg.cohorts.includes(identity)) {
      failures.push(`cohort "${identity}" not in allowlist`)
    }
  }
  if (cfg.attributes !== undefined) {
    for (const [key, allowed] of Object.entries(cfg.attributes)) {
      const value = ctx.attributes?.[key]
      if (value === undefined || !allowed.includes(value)) {
        failures.push(`attribute "${key}"=${String(value)} not in [${allowed.join(", ")}]`)
      }
    }
  }
  if (cfg.cohortPercent !== undefined && !inCohort(ctx, cfg.cohortPercent, cfg.salt)) {
    failures.push(`cohort bucket outside ${cfg.cohortPercent}%`)
  }

  if (failures.length > 0) {
    return { verdict: false, reason: failures.join("; ") }
  }
  return { verdict: true, reason: "all segment criteria matched" }
}

export const segmentStrategy: StrategyFn = (config, ctx, _now) => run(config, ctx)
