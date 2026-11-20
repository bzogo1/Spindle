import type { EvaluationContext } from "./types"

/**
 * Deterministic cohort bucketing shared by the percentage-based, segment and
 * linear strategies.
 *
 * The hash is FNV-1a 32-bit — fast, dependency-free and stable across
 * runtimes. It is NOT cryptographic; it only needs to distribute identities
 * evenly enough for rollout percentages, which it does well.
 */

const FNV_OFFSET_BASIS = 0x811c9dc5
const FNV_PRIME = 0x01000193
/** Bucket space: 0–9999, i.e. 0.01% resolution. */
const BUCKET_SPACE = 10_000

/** Hash an arbitrary string into a stable bucket in [0, 9999]. */
export function hashBucket(input: string): number {
  let hash = FNV_OFFSET_BASIS
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, FNV_PRIME)
  }
  return (hash >>> 0) % BUCKET_SPACE
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}

/**
 * Resolve the identity used for cohort bucketing: explicit `cohort`, then
 * `userId`/`id` attributes, then a shared "anonymous" bucket.
 */
export function resolveCohortIdentity(ctx: EvaluationContext): string {
  return (
    asNonEmptyString(ctx.cohort) ??
    asNonEmptyString(ctx.subjectId) ??
    asNonEmptyString(ctx.attributes?.userId) ??
    asNonEmptyString(ctx.attributes?.id) ??
    "anonymous"
  )
}

/** Clamp a percentage config value into [0, 100]. */
export function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(100, Math.max(0, value))
}

/**
 * Whether `ctx` falls inside a `percent` rollout. Deterministic: the same
 * (flagKey, salt, identity) always produces the same answer.
 *
 * Boundary semantics: `percent <= 0` enables nobody, `percent >= 100`
 * enables everybody; otherwise the cohort bucket must be `< percent * 100`.
 */
export function inCohort(ctx: EvaluationContext, percent: number, salt?: string): boolean {
  const clamped = clampPercent(percent)
  if (clamped <= 0) return false
  if (clamped >= 100) return true

  const input = [salt ?? "", ctx.flagKey ?? "", resolveCohortIdentity(ctx)].join("|")
  return hashBucket(input) < clamped * 100
}
