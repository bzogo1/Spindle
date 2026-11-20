/**
 * Types for feature-flag analytics.
 *
 * These events are produced by the flag evaluation layer (see the hook point
 * documented in docs/feature-flags/analytics.md) and consumed by pluggable
 * sinks. Events are deliberately non-identifying: the raw user key never
 * leaves the recorder — only a truncated, non-reversible hash.
 */

export const FLAG_ANALYTICS_EVENT = "flag_exposure" as const

/**
 * - `exposure`: the flag value was actually applied to the user's experience.
 * - `evaluation`: the flag was merely evaluated (e.g. checked for a gate that
 *   decided not to expose it). Useful for measuring check-to-exposure drop-off.
 */
export type FlagExposureKind = "exposure" | "evaluation"

export type FlagExposureEvent = {
  /** Discriminator so JSONL consumers can filter mixed event streams. */
  event: typeof FLAG_ANALYTICS_EVENT
  kind: FlagExposureKind
  /** Flag key exactly as registered in the flag system. */
  flag: string
  /**
   * Variant label the subject was assigned ("control", "treatment", "on", …).
   * `null` when the flag is boolean and only `value` is meaningful.
   */
  variant: string | null
  /**
   * The evaluated flag value, when JSON-serialisable. Booleans, numbers and
   * short strings are typical; keep it small — this lands in log pipelines.
   */
  value: unknown
  /** Deterministic bucket in `[0, bucketCount)` for (flag, subject). */
  bucket: number
  /** Bucket space used for this event (default 100 → percentage points). */
  bucketCount: number
  /**
   * Non-identifying hash of the subject key, scoped to the flag. Lets
   * aggregation count unique subjects and detect stickiness without storing
   * anything reversible.
   */
  subjectHash: string
  /** Deployment environment the evaluation ran in. */
  environment: string
  /** ISO-8601 timestamp of the evaluation. */
  timestamp: string
}

export type RecordFlagExposureInput = {
  /** Flag key. Required, 1–128 chars. */
  flag: string
  /**
   * Opaque subject key — user id, session id, or any stable per-subject
   * string. Hashed before it is stored; never sent to a sink.
   */
  userKey: string
  variant?: string | null
  value?: unknown
  kind?: FlagExposureKind
  /** Overrides the default environment (clientEnv.NODE_ENV). */
  environment?: string
  /** Overrides the event timestamp (defaults to now). */
  timestamp?: Date | number | string
  /** Bucket space size; 100 (default) makes buckets percentage points. */
  bucketCount?: number
  /**
   * The bucket the flag system actually used for this decision, when the
   * caller has it (e.g. `hashToBucket(subjectId)` from `../evaluate` or a
   * rollout-strategy bucket). Pass it so analytics buckets match assignment
   * buckets exactly; when omitted a diagnostic bucket is computed locally.
   */
  bucket?: number
}

/**
 * Destination for flag analytics events. Implementations must never throw
 * into the recorder — the recorder additionally wraps calls defensively.
 */
export interface FlagAnalyticsSink {
  record(event: FlagExposureEvent): void | Promise<void>
  /** Optional: flush buffered/batched events (HTTP sink). */
  flush?(): void | Promise<void>
}
