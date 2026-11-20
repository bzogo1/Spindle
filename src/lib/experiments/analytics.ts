/**
 * Experiment analytics — exposure and metric events.
 *
 * Hook point: wherever an experiment variant is applied to a subject's
 * experience, call `recordExperimentExposure()`; wherever a
 * `primaryMetric`-style outcome is observed, call
 * `recordExperimentMetric()`. See docs/experiments/framework.md and
 * docs/experiments/tracking.md (owned by the tracking workstream).
 *
 * Guarantees (mirroring src/lib/feature-flags/analytics):
 * - Never throws and never blocks assignment: sink errors are swallowed.
 * - Non-identifying: `subjectId` is hashed (bucket.ts `subjectHash`) before
 *   it reaches a sink; the raw id never leaves this module.
 * - Cheap: one hash + one object allocation per call; sinks do the I/O.
 */

import { clientEnv } from "@/lib/env"

import { subjectHash } from "./bucket"

export const EXPERIMENT_EXPOSURE_EVENT = "experiment_exposure" as const
export const EXPERIMENT_METRIC_EVENT = "experiment_metric" as const

export type ExperimentEventKind = "exposure" | "metric"

export type ExperimentEvent = {
  /** Discriminator so JSONL consumers can filter mixed event streams. */
  event: typeof EXPERIMENT_EXPOSURE_EVENT | typeof EXPERIMENT_METRIC_EVENT
  kind: ExperimentEventKind
  /** Experiment key exactly as registered. */
  experiment: string
  /**
   * Variant label the subject was assigned ("control", "treatment", …),
   * or null when the subject is enrolled but unassigned / not enrolled.
   */
  variant: string | null
  /**
   * For `kind: "metric"`: the metric name (e.g. "signup_completed").
   * Null for exposures.
   */
  metric: string | null
  /**
   * For `kind: "metric"`: the observed value (usually 1 for a conversion,
   * or a numeric measure). Null for exposures.
   */
  value: unknown
  /** Deterministic variant bucket in `[0, 10000)` when known. */
  bucket: number | null
  bucketCount: number
  /**
   * Non-identifying hash of the subject id, scoped to the experiment.
   * Lets aggregation count unique subjects without storing anything
   * reversible.
   */
  subjectHash: string
  /** Deployment environment the event was recorded in. */
  environment: string
  /** ISO-8601 timestamp of the event. */
  timestamp: string
}

export type RecordExperimentEventInput = {
  /** Experiment key. Required, 1–128 chars. */
  experiment: string
  /**
   * Opaque per-subject key — user id, session id, anonymous id. Hashed
   * before it is stored; never sent to a sink.
   */
  subjectId: string
  variant?: string | null
  /** "exposure" (default) or "metric". */
  kind?: ExperimentEventKind
  /** Metric name — required for `kind: "metric"`. */
  metric?: string
  /** Observed metric value — required for `kind: "metric"`. */
  value?: unknown
  /**
   * The bucket `assignVariant()` returned for this subject, when the caller
   * has it. Pass it so analytics buckets match assignment buckets exactly.
   */
  bucket?: number
  /** Overrides the default environment (clientEnv.NODE_ENV). */
  environment?: string
  /** Overrides the event timestamp (defaults to now). */
  timestamp?: Date | number | string
}

/**
 * Destination for experiment events. Implementations must never throw into
 * the recorder — the recorder additionally wraps calls defensively.
 */
export interface ExperimentAnalyticsSink {
  record(event: ExperimentEvent): void | Promise<void>
  /** Optional: flush buffered/batched events (HTTP sink). */
  flush?(): void | Promise<void>
}

const MAX_EXPERIMENT_LENGTH = 128
const MAX_METRIC_LENGTH = 128
const DEFAULT_BUCKET_COUNT = 10_000

/**
 * Default sink mirrors src/lib/analytics.ts: visible in dev/test via
 * console.debug, silent in production until a real sink is installed with
 * `setExperimentAnalyticsSink()`.
 */
const defaultSink: ExperimentAnalyticsSink = {
  record(event) {
    if (clientEnv.NODE_ENV !== "production") {
      console.debug("[experiment-analytics]", JSON.stringify(event))
    }
  },
}

let activeSink: ExperimentAnalyticsSink = defaultSink

/**
 * Installs the sink all subsequent events go to. Pass `null` to restore the
 * default console/silent behaviour.
 */
export function setExperimentAnalyticsSink(sink: ExperimentAnalyticsSink | null): void {
  activeSink = sink ?? defaultSink
}

/** Test/diagnostic helper: the sink currently receiving events. */
export function getExperimentAnalyticsSink(): ExperimentAnalyticsSink {
  return activeSink
}

function toIsoTimestamp(input: Date | number | string | undefined): string {
  if (input === undefined) return new Date().toISOString()
  if (input instanceof Date) return input.toISOString()
  if (typeof input === "number") return new Date(input).toISOString()
  const parsed = new Date(input)
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString()
}

/** Keeps `value` JSON-serialisable; unserialisable input degrades safely. */
function toJsonSafe(value: unknown): unknown {
  if (value === undefined) return null
  if (typeof value === "function" || typeof value === "symbol") return null
  if (value === null || typeof value !== "object") {
    try {
      JSON.stringify(value)
      return value
    } catch {
      return String(value)
    }
  }
  try {
    JSON.stringify(value)
    return value
  } catch {
    return "[unserializable]"
  }
}

function safeRecord(event: ExperimentEvent): void {
  try {
    const result = activeSink.record(event)
    if (result instanceof Promise) {
      result.catch(() => {})
    }
  } catch {
    // Swallow — analytics must never break assignment.
  }
}

function buildEvent(input: RecordExperimentEventInput): ExperimentEvent | null {
  if (
    typeof input?.experiment !== "string" ||
    input.experiment.length === 0 ||
    input.experiment.length > MAX_EXPERIMENT_LENGTH ||
    typeof input.subjectId !== "string" ||
    input.subjectId.length === 0
  ) {
    return null
  }

  const kind = input.kind ?? "exposure"
  const metric =
    kind === "metric" && typeof input.metric === "string" && input.metric.length > 0
      ? input.metric.slice(0, MAX_METRIC_LENGTH)
      : null
  // A metric event without a metric name carries no information — drop it.
  if (kind === "metric" && metric === null) return null

  const providedBucket =
    typeof input.bucket === "number" && Number.isFinite(input.bucket)
      ? Math.min(DEFAULT_BUCKET_COUNT - 1, Math.max(0, Math.floor(input.bucket)))
      : null

  return {
    event: kind === "metric" ? EXPERIMENT_METRIC_EVENT : EXPERIMENT_EXPOSURE_EVENT,
    kind,
    experiment: input.experiment,
    variant: typeof input.variant === "string" ? input.variant : null,
    metric,
    value: kind === "metric" ? toJsonSafe(input.value ?? 1) : null,
    bucket: providedBucket,
    bucketCount: DEFAULT_BUCKET_COUNT,
    subjectHash: subjectHash(input.experiment, input.subjectId),
    environment: input.environment ?? clientEnv.NODE_ENV,
    timestamp: toIsoTimestamp(input.timestamp),
  }
}

/**
 * Records that a subject was exposed to an experiment variant. Call once per
 * (experiment, subject) per session/render where the variant is actually
 * applied — not on mere evaluation.
 */
export function recordExperimentExposure(input: RecordExperimentEventInput): void {
  const event = buildEvent({ ...input, kind: "exposure" })
  if (event) safeRecord(event)
}

/**
 * Records an outcome metric for an experiment subject (e.g. a conversion).
 * `metric` names the measurement; `value` defaults to 1.
 */
export function recordExperimentMetric(input: RecordExperimentEventInput): void {
  const event = buildEvent({ ...input, kind: "metric" })
  if (event) safeRecord(event)
}

/** Drains buffered sink state (e.g. a batching sink's queue). Best-effort. */
export async function flushExperimentAnalytics(): Promise<void> {
  try {
    await activeSink.flush?.()
  } catch {
    // Best-effort.
  }
}
