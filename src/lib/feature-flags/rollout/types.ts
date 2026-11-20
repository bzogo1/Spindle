/**
 * Shared types for feature-flag rollout strategies.
 *
 * These types are intentionally self-contained: the rollout module only
 * needs a flag key, an evaluation context and a timestamp. The flag
 * evaluation layer (owned elsewhere) is responsible for loading the flag's
 * config, building the context and calling `evaluateRollout()`.
 */

/** A single attribute value that segment rules can match against. */
export type FlagAttributeValue = string | number | boolean

/**
 * Everything a rollout strategy may look at when deciding whether a flag is
 * enabled for the current request/evaluation.
 */
export interface EvaluationContext {
  /**
   * Stable identifier of the flag being evaluated. Included in cohort hash
   * inputs so the same user lands in different buckets for different flags.
   * Optional, but strongly recommended.
   */
  flagKey?: string
  /** Billing plan / tier, e.g. "free" | "pro" | "enterprise". */
  plan?: string | null
  /** Deployment environment, e.g. "production" | "staging" | "preview". */
  env?: string
  /**
   * Stable cohort identifier used for deterministic percentage bucketing —
   * typically a user id, device id or experiment bucket. When absent, the
   * `subjectId`/`userId`/`id` attributes are tried, then all anonymous
   * traffic shares a single deterministic bucket.
   */
  cohort?: string | null
  /**
   * Alias for `cohort`, matching the `subjectId` option name used by
   * `evaluateFlag()` in `../evaluate.ts`. `cohort` wins when both are set.
   */
  subjectId?: string | null
  /** Extra attributes available to segment matching. */
  attributes?: Record<string, FlagAttributeValue>
  /**
   * Caller-supplied emergency kill switch (e.g. derived from an env var or
   * remote config). When true, `evaluateRollout()` disables the flag before
   * any strategy runs, regardless of plan configuration.
   */
  killSwitch?: boolean
}

/**
 * A strategy's verdict for one evaluation:
 * - `true`  — the strategy votes enabled.
 * - `false` — the strategy votes disabled (short-circuits the chain).
 * - `null`  — the strategy abstains; it has no opinion and does not affect
 *   the outcome (e.g. a schedule with no matching window is `false`, but a
 *   segment with no criteria configured abstains).
 */
export type Verdict = boolean | null

/** What a single strategy returns for one evaluation. */
export interface StrategyOutcome {
  verdict: Verdict
  /** Human-readable explanation, surfaced in evaluation results/logs. */
  reason: string
}

/**
 * A rollout strategy: a pure function of (config, context, now) returning a
 * verdict. `now` is always injected so strategies are deterministic and
 * testable — never read the system clock inside a strategy.
 */
export type StrategyFn = (config: unknown, ctx: EvaluationContext, now: Date) => StrategyOutcome
