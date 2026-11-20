import { clientEnv } from "@/lib/env"

import { evaluateFlag } from "./evaluate"
import { readFlagEnvOverrides } from "./env"
import { featureFlags, getFlagDefinition, listFlagNames, type FlagName } from "./flags"

/**
 * Server-side feature flag evaluation for React Server Components, server
 * actions, and route handlers.
 *
 * Environment overrides (`FEATURE_FLAG_*`) and the per-environment defaults
 * are resolved here; `subjectId` must be supplied by the caller (for example
 * the authenticated user id) for percentage rollouts. Without one, every
 * caller shares the empty-string bucket — pass a stable id whenever the flag
 * uses `{ percentage }` targets.
 */

export type ServerFlagOptions = {
  /**
   * Environment name for `defaults[environment]`. Defaults to `NODE_ENV`;
   * pass a deployment-specific name (e.g. `staging` from `VERCEL_ENV`) to use
   * its defaults entry.
   */
  environment?: string
  /** Stable subject id for percentage rollouts. */
  subjectId?: string
}

/** Evaluates one registered flag on the server. Unknown names → false. */
export function getFeatureFlag(name: FlagName, options: ServerFlagOptions = {}): boolean {
  const definition = getFlagDefinition(name)
  if (!definition) return false

  return evaluateFlag(definition, {
    environment: options.environment ?? clientEnv.NODE_ENV,
    subjectId: options.subjectId,
    overrides: readFlagEnvOverrides(),
  })
}

/** Evaluates every registered flag. Useful for embedding a snapshot for the client. */
export function getFeatureFlags(options: ServerFlagOptions = {}): Record<FlagName, boolean> {
  const overrides = readFlagEnvOverrides()
  const environment = options.environment ?? clientEnv.NODE_ENV

  return Object.fromEntries(
    listFlagNames().map((name) => [
      name,
      evaluateFlag(featureFlags[name], {
        environment,
        subjectId: options.subjectId,
        overrides,
      }),
    ]),
  ) as Record<FlagName, boolean>
}
