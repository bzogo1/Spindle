/**
 * Feature flag types.
 *
 * A flag resolves to a boolean. The "target" it resolves from is either a
 * plain boolean or a percentage rollout: `{ percentage: 25 }` enables the
 * flag for a deterministic 25% of subjects, chosen by a stable hash of the
 * subject id (user id, session id, or anonymous id). See `evaluate.ts`.
 */

export type FlagTarget = boolean | { percentage: number }

/**
 * Per-environment defaults. `fallback` is required and applies to any
 * environment without an explicit entry; the other keys match the environment
 * name the caller evaluates against (`NODE_ENV` by default — development,
 * test, production — but callers may pass deployment-specific names such as
 * `staging` via the `environment` option).
 */
export type FlagDefaults = { fallback: FlagTarget } & Partial<Record<string, FlagTarget>>

export interface FlagDefinition {
  /** Stable identifier, e.g. `"new-dashboard"`. Drives the env var name. */
  name: string
  /** Why the flag exists and when it should be removed. */
  description: string
  defaults: FlagDefaults
}
