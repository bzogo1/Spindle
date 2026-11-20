import { clampPercent, enrollmentBucket, variantBucket } from "./bucket"
import type { ExperimentAssignment, ExperimentDefinition, ExperimentVariant } from "./types"

/**
 * Pure experiment assignment. No I/O, no `process.env`, no React — safe to
 * import from server components, route handlers, client components, and
 * tests.
 *
 * Resolution order for `assignVariant()`:
 *   1. status !== "running"            → variant null ("not-running")
 *   2. outside [startDate, endDate)    → variant null ("outside-window")
 *   3. enrollment bucket ≥ traffic%    → variant null ("not-enrolled")
 *   4. variant weights                 → cumulative walk over the variant
 *                                        bucket; remainder → null
 *                                        ("unassigned-variant")
 */

export type AssignOptions = {
  /**
   * Stable subject identity — user id, session id, or anonymous id. With no
   * subject id the empty string is hashed, so every anonymous caller lands
   * in the same bucket (same caveat as feature-flag rollouts).
   */
  subjectId?: string
  /** Evaluation instant for the date window. Injectable for tests. */
  now?: Date
}

function withinWindow(definition: ExperimentDefinition, now: Date): boolean {
  if (definition.startDate) {
    const start = new Date(definition.startDate)
    if (!Number.isNaN(start.getTime()) && now.getTime() < start.getTime()) return false
  }
  if (definition.endDate) {
    const end = new Date(definition.endDate)
    if (!Number.isNaN(end.getTime()) && now.getTime() >= end.getTime()) return false
  }
  return true
}

function unassigned(
  definition: ExperimentDefinition,
  subjectId: string,
  bucket: number,
  enrolled: boolean,
  reason: ExperimentAssignment["reason"],
): ExperimentAssignment {
  return {
    experiment: definition.name,
    subjectId,
    variant: null,
    bucket,
    enrolled,
    reason,
  }
}

/**
 * Picks the variant for a subject by walking cumulative weights against the
 * variant bucket (`[0, 10000)` treated as basis points of percent).
 * Returns null when the subject falls into the weight remainder.
 */
export function pickVariant(
  variants: ExperimentVariant[],
  bucket: number,
): ExperimentVariant | null {
  // bucket is 0–9999; scale weights (percent) to the same space.
  const position = (bucket / 10_000) * 100
  let cumulative = 0
  for (const variant of variants) {
    cumulative += clampPercent(variant.weight)
    if (position < cumulative) return variant
  }
  return null
}

/**
 * Resolves the experiment assignment for a subject. Always returns an
 * `ExperimentAssignment` — callers check `variant`/`enrolled` rather than
 * branching on exceptions.
 */
export function assignVariant(
  definition: ExperimentDefinition,
  options: AssignOptions = {},
): ExperimentAssignment {
  const subjectId = options.subjectId ?? ""
  const now = options.now ?? new Date()
  const key = definition.name
  const salt = definition.salt

  const enrollBucket = enrollmentBucket(key, subjectId, salt)

  if ((definition.status ?? "running") !== "running") {
    return unassigned(definition, subjectId, enrollBucket, false, "not-running")
  }
  if (!withinWindow(definition, now)) {
    return unassigned(definition, subjectId, enrollBucket, false, "outside-window")
  }

  const traffic = clampPercent(definition.traffic ?? 100)
  const enrolled = traffic >= 100 || (traffic > 0 && enrollBucket < traffic * 100)
  if (!enrolled) {
    return unassigned(definition, subjectId, enrollBucket, false, "not-enrolled")
  }

  const bucket = variantBucket(key, subjectId, salt)
  const variant = pickVariant(definition.variants, bucket)

  return {
    experiment: key,
    subjectId,
    variant: variant?.name ?? null,
    bucket,
    enrolled: true,
    reason: variant ? "assigned" : "unassigned-variant",
  }
}
