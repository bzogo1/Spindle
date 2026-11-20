import type { EvaluationContext, StrategyFn, StrategyOutcome } from "./types"

/**
 * Kill switch: an emergency override that can only DISABLE a flag, never
 * enable one. Use it as the first step in a rollout plan (or rely on
 * `evaluateRollout()`'s built-in `plan.killSwitch` / `ctx.killSwitch`
 * short-circuit, which runs before any strategy).
 *
 * Config (optional — defaults to reading `ctx.killSwitch`):
 * ```ts
 * true | false | { disabled?: boolean }
 * ```
 *
 * Returns `false` when the switch is triggered and `null` (abstain) otherwise,
 * so it composes cleanly: other strategies still decide when the switch is
 * off. It deliberately cannot force-enable a flag that other strategies
 * disabled.
 */
export type KillSwitchConfig = boolean | { disabled?: boolean }

function isTriggered(config: unknown, ctx: EvaluationContext): boolean {
  let disabled: boolean | undefined
  if (typeof config === "boolean") {
    disabled = config
  } else if (typeof config === "object" && config !== null) {
    const value = (config as { disabled?: unknown }).disabled
    if (value !== undefined && typeof value !== "boolean") {
      throw new TypeError("kill-switch `disabled` must be a boolean")
    }
    disabled = value as boolean | undefined
  } else if (config !== undefined) {
    throw new TypeError("kill-switch config must be a boolean or { disabled?: boolean }")
  }
  // The caller-supplied emergency switch is independent of config: either
  // one being set triggers the kill switch.
  return disabled === true || ctx.killSwitch === true
}

function run(config: unknown, ctx: EvaluationContext): StrategyOutcome {
  if (isTriggered(config, ctx)) {
    return { verdict: false, reason: "kill switch is active" }
  }
  return { verdict: null, reason: "kill switch is off" }
}

export const killSwitchStrategy: StrategyFn = (config, ctx, _now) => run(config, ctx)
