import { detectLocale } from "@/lib/i18n/locale"
import type { Locale } from "@/lib/i18n/locale"

import { getAnonymousId } from "./anonymous-id"
import {
  trackExperimentConversion,
  trackExperimentExposure,
  trackResultClicked,
  type ResultClickedInput,
} from "./tracker"
import type { RankingConfig } from "@/lib/search"

/**
 * Client-side A/B experiment framework (task 38).
 *
 * Variant assignment is sticky: `hash(anonId + experimentId)` is bucketed
 * into one of the configured variants, persisted in localStorage so the
 * same visitor always sees the same variant. First assignment emits an
 * `experiment_exposure` event into the analytics store; conversions are
 * logged via `recordConversion` (which also emits
 * `experiment_conversion`).
 */

export type ExperimentVariant<T = unknown> = {
  id: string
  /** Relative traffic weight; defaults to 1. */
  weight?: number
  /** Variant payload (e.g. ranking overrides). */
  payload?: T
}

export type ExperimentDefinition<T = unknown> = {
  id: string
  variants: ExperimentVariant<T>[]
}

const ASSIGNMENT_KEY_PREFIX = "spindle-search-exp:"

/**
 * In-module session caches. When the localStorage assignment write fails
 * (private mode, quota), `getExperiment` would otherwise re-bucket *and*
 * re-log an exposure on every call. These maps make assignment sticky for
 * the page lifetime and guarantee at most one exposure event per
 * experiment+visitor per page load, regardless of storage availability.
 */
const sessionAssignments = new Map<string, string>()
const sessionExposures = new Set<string>()

function sessionKey(experimentId: string, anonId: string): string {
  return `${experimentId}:${anonId}`
}

/** Test hook: clear in-module session caches. */
export function resetExperimentSessionForTests() {
  sessionAssignments.clear()
  sessionExposures.clear()
}

/** FNV-1a hash → stable uint32. */
export function hashString(input: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

function assignmentKey(experimentId: string): string {
  return `${ASSIGNMENT_KEY_PREFIX}${experimentId}`
}

function readStoredAssignment(experimentId: string): string | null {
  if (typeof window === "undefined") return null
  try {
    return window.localStorage.getItem(assignmentKey(experimentId))
  } catch {
    return null
  }
}

function writeStoredAssignment(experimentId: string, variantId: string) {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(assignmentKey(experimentId), variantId)
  } catch {
    // Storage unavailable — assignment still works in-memory per call.
  }
}

/**
 * Deterministically bucket `anonId` into one of `variants` by weight.
 * Pure — exported for tests.
 */
export function assignVariant<T>(
  experimentId: string,
  anonId: string,
  variants: ExperimentVariant<T>[],
): ExperimentVariant<T> {
  const totalWeight = variants.reduce((sum, v) => sum + Math.max(0, v.weight ?? 1), 0)
  if (totalWeight <= 0 || variants.length === 0) {
    return variants[0] ?? { id: "control" }
  }
  const bucket = hashString(`${experimentId}:${anonId}`) % totalWeight
  let cumulative = 0
  for (const variant of variants) {
    cumulative += Math.max(0, variant.weight ?? 1)
    if (bucket < cumulative) return variant
  }
  return variants[variants.length - 1]!
}

export type ActiveExperiment<T = unknown> = {
  experimentId: string
  variant: ExperimentVariant<T>
  /** True the first time this visitor is bucketed (drives exposure logging). */
  isNewAssignment: boolean
  /** Log a conversion for the assigned variant. */
  recordConversion: (conversion: string) => boolean
}

/**
 * Resolve (and persist) the visitor's variant for an experiment.
 * Emits `experiment_exposure` exactly once per visitor per experiment per
 * page load (tracked via the stored assignment plus the in-module session
 * cache, so storage failures can't cause exposure spam).
 *
 * NOTE: call this from an effect or event handler (or inside
 * `useMemo`/`useState` initializer on the client), not during render of a
 * server component — it writes localStorage and analytics events.
 */
export function getExperiment<T = unknown>(
  experiment: ExperimentDefinition<T>,
  context?: { anonId?: string; locale?: string },
): ActiveExperiment<T> {
  const anonId = context?.anonId ?? (typeof window === "undefined" ? "ssr" : getAnonymousId())
  const sKey = sessionKey(experiment.id, anonId)
  const validIds = new Set(experiment.variants.map((v) => v.id))

  let variant: ExperimentVariant<T>
  let isNewAssignment = false

  const sessionVariantId = sessionAssignments.get(sKey)
  const stored = sessionVariantId ?? readStoredAssignment(experiment.id)

  if (stored && validIds.has(stored)) {
    variant = experiment.variants.find((v) => v.id === stored)!
    sessionAssignments.set(sKey, variant.id)
    // A stored/session assignment means the visitor was already bucketed —
    // exposure is a first-assignment signal and is not re-logged here.
  } else {
    variant = assignVariant(experiment.id, anonId, experiment.variants)
    sessionAssignments.set(sKey, variant.id)
    writeStoredAssignment(experiment.id, variant.id)
    isNewAssignment = true
  }

  if (isNewAssignment && !sessionExposures.has(sKey)) {
    sessionExposures.add(sKey)
    trackExperimentExposure(experiment.id, variant.id, {
      anonId: context?.anonId,
      locale: context?.locale ?? detectLocale(),
    })
  }

  return {
    experimentId: experiment.id,
    variant,
    isNewAssignment,
    recordConversion: (conversion) =>
      trackExperimentConversion(experiment.id, variant.id, conversion, {
        anonId: context?.anonId,
        locale: context?.locale,
      }),
  }
}

/** Clear a stored assignment (e.g. after an experiment ends). */
export function clearExperimentAssignment(experimentId: string) {
  if (typeof window === "undefined") return
  try {
    window.localStorage.removeItem(assignmentKey(experimentId))
  } catch {
    // ignore
  }
  // Drop session caches for this experiment so the next getExperiment call
  // re-assigns (and re-logs exposure) as if the visitor were new.
  for (const key of [...sessionAssignments.keys()]) {
    if (key.startsWith(`${experimentId}:`)) sessionAssignments.delete(key)
  }
  for (const key of [...sessionExposures]) {
    if (key.startsWith(`${experimentId}:`)) sessionExposures.delete(key)
  }
}

// ---------------------------------------------------------------------------
// Built-in experiment: ranking weights
// ---------------------------------------------------------------------------

export type RankingExperimentPayload = {
  /** Partial ranking overrides applied to SearchOptions.ranking. */
  ranking?: Partial<RankingConfig>
}

/**
 * Example ranking experiment: control keeps default weights; treatment
 * disables personalization and synonym expansion to test whether the
 * boosts help or hurt result quality.
 */
export const RANKING_EXPERIMENT: ExperimentDefinition<RankingExperimentPayload> = {
  id: "search-ranking-v1",
  variants: [
    { id: "control", weight: 1, payload: {} },
    {
      id: "no-personalization",
      weight: 1,
      payload: { ranking: { personalization: false, personalizationBoost: 0 } },
    },
    {
      id: "no-synonyms",
      weight: 1,
      payload: { ranking: { synonyms: false } },
    },
  ],
}

/**
 * Hook-friendly helper: resolve the ranking experiment and return the
 * `SearchOptions.ranking` override for the visitor's variant. Callers pass
 * the result into `useSearchIndex({ ranking })`.
 */
export function rankingOverridesForVisitor(
  experiment: ExperimentDefinition<RankingExperimentPayload> = RANKING_EXPERIMENT,
): Partial<RankingConfig> | undefined {
  const active = getExperiment(experiment)
  return active.variant.payload?.ranking
}

/** Track a result click through an experiment (exposure already logged). */
export function trackExperimentResultClick(
  active: ActiveExperiment<unknown>,
  input: ResultClickedInput,
): boolean {
  const clicked = trackResultClicked(input)
  active.recordConversion("result_clicked")
  return clicked
}

export type { Locale }
