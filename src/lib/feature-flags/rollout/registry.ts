import { linearStrategy } from "./linear"
import { killSwitchStrategy } from "./kill-switch"
import { percentageStrategy } from "./percentage"
import { scheduleStrategy } from "./schedule"
import { segmentStrategy } from "./segment"
import type { EvaluationContext, StrategyFn, StrategyOutcome, Verdict } from "./types"

/**
 * Strategy registry and rollout-plan composer.
 *
 * A `RolloutPlan` is an ordered list of `{ strategy, config }` steps evaluated
 * left-to-right. Semantics:
 *
 * - A step returning `false` disables the flag and short-circuits the chain
 *   (later steps are not evaluated).
 * - A step returning `true` or `null` lets evaluation continue.
 * - The flag is enabled iff no step voted `false` — i.e. strategies compose
 *   with logical AND, and abstentions are neutral.
 *
 * Kill-switch precedence: `plan.killSwitch` or `ctx.killSwitch` being true
 * disables the flag before any step runs. Placing a `kill-switch` step first
 * achieves the same within the chain.
 */

export interface RolloutStep {
  /** Registered strategy name, e.g. "percentage". */
  strategy: string
  /** Strategy-specific config (see each strategy's docs). */
  config?: unknown
}

export interface RolloutPlan {
  /**
   * Top-level emergency disable. When true the flag is disabled before any
   * strategy runs — the highest-precedence kill switch.
   */
  killSwitch?: boolean
  steps: readonly RolloutStep[]
}

export interface RolloutStepResult extends StrategyOutcome {
  strategy: string
}

export interface RolloutResult {
  enabled: boolean
  results: RolloutStepResult[]
}

/** Built-in strategies shipped with this module. */
export const rolloutStrategies: Record<string, StrategyFn> = {
  linear: linearStrategy,
  percentage: percentageStrategy,
  segment: segmentStrategy,
  schedule: scheduleStrategy,
  "kill-switch": killSwitchStrategy,
}

/**
 * Register (or override) a strategy. Useful for tests and for hosts that want
 * to add project-specific strategies without touching this module.
 */
export function registerRolloutStrategy(name: string, fn: StrategyFn): void {
  if (typeof name !== "string" || name.length === 0) {
    throw new TypeError("strategy name must be a non-empty string")
  }
  if (typeof fn !== "function") {
    throw new TypeError(`strategy "${name}" must be a function`)
  }
  rolloutStrategies[name] = fn
}

function resolveStrategy(name: string, extra: Record<string, StrategyFn> | undefined): StrategyFn {
  const fn = extra?.[name] ?? rolloutStrategies[name]
  if (!fn) {
    throw new Error(`Unknown rollout strategy "${name}"`)
  }
  return fn
}

/**
 * Evaluate a rollout plan for one flag.
 *
 * @param plan    ordered strategy steps (+ optional top-level kill switch)
 * @param ctx     evaluation context (include `flagKey` for stable hashing)
 * @param now     evaluation instant — injected for determinism
 * @param extra   optional per-call strategy overrides/additions
 */
export function evaluateRollout(
  plan: RolloutPlan,
  ctx: EvaluationContext,
  now: Date = new Date(),
  extra?: Record<string, StrategyFn>,
): RolloutResult {
  const results: RolloutStepResult[] = []

  if (plan.killSwitch === true || ctx.killSwitch === true) {
    results.push({
      strategy: "kill-switch",
      verdict: false as Verdict,
      reason: "kill switch active (plan or context)",
    })
    return { enabled: false, results }
  }

  for (const step of plan.steps) {
    const fn = resolveStrategy(step.strategy, extra)
    const outcome = fn(step.config, ctx, now)
    results.push({ strategy: step.strategy, ...outcome })
    if (outcome.verdict === false) {
      break
    }
  }

  return { enabled: results.every((r) => r.verdict !== false), results }
}
