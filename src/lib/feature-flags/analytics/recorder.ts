/**
 * Flag-analytics recorder — the single entry point flag code calls.
 *
 * Hook point: wherever the flag system computes a value for a subject, call
 * `recordFlagExposure({ flag, userKey, variant, value, kind })`. See
 * docs/feature-flags/analytics.md for the recommended call sites.
 *
 * Guarantees:
 * - Never throws and never blocks evaluation: sink errors (sync or async) are
 *   swallowed. Analytics must not be able to break flag resolution.
 * - Non-identifying: `userKey` is hashed (bucket.ts) before it reaches a sink;
 *   the raw key never leaves this module.
 * - Cheap: one hash + one object allocation per call; sinks do the I/O.
 */

import { clientEnv } from "@/lib/env"

import { bucketIndex, subjectHash } from "./bucket"
import {
  FLAG_ANALYTICS_EVENT,
  type FlagAnalyticsSink,
  type FlagExposureEvent,
  type RecordFlagExposureInput,
} from "./types"

const MAX_FLAG_LENGTH = 128
const DEFAULT_BUCKET_COUNT = 100

/**
 * Default sink mirrors src/lib/analytics.ts: visible in dev/test via
 * console.debug, silent in production until a real sink is installed with
 * `setFlagAnalyticsSink()` (e.g. the JSONL or HTTP sink from sinks.ts).
 */
const defaultSink: FlagAnalyticsSink = {
  record(event) {
    if (clientEnv.NODE_ENV !== "production") {
      console.debug("[flag-analytics]", JSON.stringify(event))
    }
  },
}

let activeSink: FlagAnalyticsSink = defaultSink

/**
 * Installs the sink all subsequent events go to. Pass `null` to restore the
 * default console/silent behaviour. Typical wiring (server startup):
 *
 *   setFlagAnalyticsSink(createJsonlFileSink(process.env.FLAG_EVENTS_PATH))
 */
export function setFlagAnalyticsSink(sink: FlagAnalyticsSink | null): void {
  activeSink = sink ?? defaultSink
}

/** Test/diagnostic helper: the sink currently receiving events. */
export function getFlagAnalyticsSink(): FlagAnalyticsSink {
  return activeSink
}

function toIsoTimestamp(input: Date | number | string | undefined): string {
  if (input === undefined) return new Date().toISOString()
  if (input instanceof Date) return input.toISOString()
  if (typeof input === "number") return new Date(input).toISOString()
  const parsed = new Date(input)
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString()
}

/**
 * Keeps `value` JSON-serialisable; anything that would make JSON.stringify
 * throw (BigInt, circular refs) degrades to a string placeholder.
 */
function toJsonSafe(value: unknown): unknown {
  if (value === undefined) return null
  // JSON.stringify returns undefined (not a throw) for functions and symbols —
  // storing them raw would silently drop `value` when the sink serialises.
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

function safeRecord(event: FlagExposureEvent): void {
  try {
    const result = activeSink.record(event)
    if (result instanceof Promise) {
      result.catch(() => {})
    }
  } catch {
    // Swallow — see module docs.
  }
}

/**
 * Records a flag exposure/evaluation event.
 *
 * @param input.flag     Flag key (required, ≤128 chars).
 * @param input.userKey  Opaque per-subject key — hashed, never stored raw.
 * @param input.variant  Variant label, or null for boolean flags.
 * @param input.value    Evaluated value (JSON-serialisable).
 * @param input.kind     "exposure" (default) or "evaluation".
 * @param input.bucket   The flag system's own decision bucket, when known.
 */
export function recordFlagExposure(input: RecordFlagExposureInput): void {
  if (
    typeof input?.flag !== "string" ||
    input.flag.length === 0 ||
    input.flag.length > MAX_FLAG_LENGTH ||
    typeof input.userKey !== "string" ||
    input.userKey.length === 0
  ) {
    return
  }

  const bucketCount = Math.max(1, Math.floor(input.bucketCount ?? DEFAULT_BUCKET_COUNT))

  // Prefer the bucket the flag system used for the decision; fall back to a
  // locally computed diagnostic bucket. Explicit values are clamped into range.
  const providedBucket =
    typeof input.bucket === "number" && Number.isFinite(input.bucket)
      ? Math.min(bucketCount - 1, Math.max(0, Math.floor(input.bucket)))
      : null

  const event: FlagExposureEvent = {
    event: FLAG_ANALYTICS_EVENT,
    kind: input.kind ?? "exposure",
    flag: input.flag,
    variant: typeof input.variant === "string" ? input.variant : null,
    value: toJsonSafe(input.value),
    bucket: providedBucket ?? bucketIndex(input.flag, input.userKey, bucketCount),
    bucketCount,
    subjectHash: subjectHash(input.flag, input.userKey),
    environment: input.environment ?? clientEnv.NODE_ENV,
    timestamp: toIsoTimestamp(input.timestamp),
  }

  safeRecord(event)
}

/** Drains buffered sink state (e.g. the HTTP sink's batch). Best-effort. */
export async function flushFlagAnalytics(): Promise<void> {
  try {
    await activeSink.flush?.()
  } catch {
    // Best-effort.
  }
}
