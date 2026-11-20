import type { EnvSource } from "@/lib/env"

import { FLAG_ENV_PREFIX } from "./evaluate"

/**
 * Server-side collector for `FEATURE_FLAG_*` overrides.
 *
 * This is the single module allowed to read these variables: the set of flag
 * names is open-ended (any `FEATURE_FLAG_<NAME>` may appear in the
 * environment), so the keys cannot live in the static zod env schema in
 * `src/lib/env.server.ts`. Everything else goes through `evaluate.ts`.
 */
/* eslint-disable no-restricted-properties -- FEATURE_FLAG_* is a dynamic env family that cannot be expressed in the static env schema; this module is its only reader. */
export function readFlagEnvOverrides(source?: EnvSource): Record<string, string | undefined> {
  const env = source ?? (typeof process !== "undefined" && process.env ? process.env : {})

  const overrides: Record<string, string | undefined> = {}
  for (const [key, value] of Object.entries(env)) {
    if (key.startsWith(FLAG_ENV_PREFIX)) overrides[key] = value
  }
  return overrides
}
