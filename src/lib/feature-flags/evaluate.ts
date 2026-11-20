import { clientEnv } from "@/lib/env"

import { getFlagDefinition } from "./flags"
import type { FlagDefinition, FlagTarget } from "./types"

/**
 * Pure feature-flag evaluation. No I/O, no `process.env`, no React — safe to
 * import from server components, route handlers, client components, and tests.
 * Callers supply the environment name, an optional subject id for percentage
 * rollouts, and raw env overrides (see `env.ts` for the server-side collector).
 */

export const FLAG_ENV_PREFIX = "FEATURE_FLAG_"

/**
 * Maps a flag name to its override env var: `new-dashboard` →
 * `FEATURE_FLAG_NEW_DASHBOARD`. Non-alphanumeric runs collapse to `_`.
 */
export function flagEnvKey(name: string): string {
  const suffix = name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
  return `${FLAG_ENV_PREFIX}${suffix}`
}

const TRUE_VALUES = new Set(["on", "true", "1", "yes", "enabled"])
const FALSE_VALUES = new Set(["off", "false", "0", "no", "disabled"])

/**
 * Parses a raw `FEATURE_FLAG_*` value into a flag target:
 *
 * - `on`/`true`/`1`/`yes`/`enabled` → `true`
 * - `off`/`false`/`0`/`no`/`disabled` → `false`
 * - `0`–`100` or `NN%` → `{ percentage }` rollout for the given subject
 * - anything else (including empty) → `undefined`, i.e. no override
 *
 * Note `1`/`0` are booleans, not percentages; use `1%`/`0%` for those.
 */
export function parseFlagOverride(raw: string | undefined): FlagTarget | undefined {
  if (raw === undefined) return undefined

  const value = raw.trim().toLowerCase()
  if (value.length === 0) return undefined
  if (TRUE_VALUES.has(value)) return true
  if (FALSE_VALUES.has(value)) return false

  const numeric = value.endsWith("%") ? value.slice(0, -1) : value
  if (/^\d+(\.\d+)?$/.test(numeric)) {
    const percentage = Number(numeric)
    if (percentage >= 0 && percentage <= 100) return { percentage }
  }

  return undefined
}

/**
 * Deterministic 0–99 bucket for a subject id (FNV-1a 32-bit). Stable across
 * server and client renders and across deploys — do not change the algorithm
 * without re-keying every rollout.
 */
export function hashToBucket(subjectId: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < subjectId.length; i++) {
    hash ^= subjectId.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0) % 100
}

export type FlagEvaluationOptions = {
  /**
   * Environment name used to pick `defaults[environment]`. Defaults to
   * `"production"`; server helpers pass `NODE_ENV` (or a deployment env such
   * as `staging`), the client hook passes `clientEnv.NODE_ENV`.
   */
  environment?: string
  /**
   * Stable subject identity for percentage rollouts — user id, session id, or
   * the provider's anonymous id. With no subject id the empty string is
   * hashed, so every anonymous caller lands in the same bucket.
   */
  subjectId?: string
  /**
   * Raw overrides keyed by env var name (`FEATURE_FLAG_*`). Server code builds
   * this with `readFlagEnvOverrides()`; tests and the client provider can pass
   * an explicit map.
   */
  overrides?: Record<string, string | undefined>
}

/**
 * Resolves a flag to a boolean. Accepts either a `FlagDefinition` or a
 * registered flag name (unknown names evaluate to `false` — a typo must never
 * accidentally enable a feature).
 *
 * Precedence: env override → `defaults[environment]` → `defaults.fallback`.
 * A `{ percentage }` target (from the registry or a numeric override) enables
 * the flag when `hashToBucket(subjectId) < percentage`.
 */
export function evaluateFlag(
  definition: FlagDefinition | string,
  options: FlagEvaluationOptions = {},
): boolean {
  const { environment = "production", subjectId = "", overrides } = options

  const resolved = typeof definition === "string" ? getFlagDefinition(definition) : definition
  if (!resolved) {
    if (clientEnv.NODE_ENV !== "production") {
      console.warn(`[feature-flags] unknown flag "${definition}" evaluated as false`)
    }
    return false
  }

  const override = parseFlagOverride(overrides?.[flagEnvKey(resolved.name)])
  const target = override ?? resolved.defaults[environment] ?? resolved.defaults.fallback

  if (typeof target === "boolean") return target

  const percentage = Math.min(100, Math.max(0, target.percentage))
  if (percentage <= 0) return false
  if (percentage >= 100) return true
  return hashToBucket(subjectId) < percentage
}

/**
 * Evaluates a registered flag by name. Alias for `evaluateFlag(name, options)`
 * kept for readability at call sites that only have a name.
 */
export function evaluateFlagByName(name: string, options: FlagEvaluationOptions = {}): boolean {
  return evaluateFlag(name, options)
}
