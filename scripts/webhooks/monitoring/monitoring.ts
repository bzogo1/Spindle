/**
 * Webhook delivery monitoring — pure analysis module.
 *
 * Consumes webhook *delivery attempt* records (one per HTTP attempt a sender
 * makes toward a receiver endpoint) and produces:
 *
 *  - a {@link DeliverySummary}: outcome counts, success/failure rates,
 *    latency percentiles, status-code histogram, per-endpoint breakdown,
 *    and dead-letter detection;
 *  - a list of {@link MonitoringAlert}s via {@link evaluateAlerts} when
 *    configurable thresholds are breached.
 *
 * The module is intentionally dependency-free and side-effect-free so it can
 * be unit-tested in isolation and reused by:
 *
 *  - `scripts/webhooks/monitoring/report.mjs` — CLI that reads NDJSON
 *    delivery logs (`--file`) or a built-in demo corpus (`--demo`);
 *  - future in-app instrumentation under `src/lib/webhooks/` (owned by the
 *    webhooks workstream) that wants the same aggregation in-process.
 *
 * Log format: newline-delimited JSON, one attempt per line. Field aliases are
 * tolerated — see {@link parseDeliveryAttempt}.
 */

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export type DeliveryOutcome = "success" | "failure" | "error"

/**
 * One outbound webhook delivery attempt, normalized from a log line.
 * `error` present with no HTTP `status` means a transport-level failure
 * (timeout, DNS, connection reset) rather than an HTTP rejection.
 */
export type DeliveryAttempt = {
  /** ISO-8601 timestamp of the attempt. */
  ts: string
  /** Event id (`evt_…`) when the sender records it. */
  eventId?: string
  /** Receiver endpoint URL, when known. */
  endpoint?: string
  /** 1-based attempt number within a delivery's retry sequence. */
  attempt?: number
  /** HTTP status code returned by the receiver; absent on transport errors. */
  status?: number
  /** Round-trip latency in milliseconds. */
  latencyMs?: number
  /** Error description for transport failures. */
  error?: string
  /** Explicit dead-letter marker set by the sender/queue. */
  deadLettered?: boolean
}

/** Loose input shape accepted by {@link parseDeliveryAttempt}. */
export type DeliveryAttemptInput = Record<string, unknown>

export type EndpointSummary = {
  endpoint: string
  total: number
  success: number
  failure: number
  error: number
  unhealthyRate: number
  p50LatencyMs: number | null
  p95LatencyMs: number | null
}

export type DeliverySummary = {
  total: number
  /** Attempts with a 2xx status and no transport error. */
  success: number
  /** Attempts that received a non-2xx HTTP status. */
  failure: number
  /** Attempts that never got an HTTP response (timeout/DNS/reset). */
  error: number
  /** (failure + error) / total — the headline health metric. */
  unhealthyRate: number
  /** success / total. */
  successRate: number
  /** Trailing run of non-success attempts at the end of the log (streak). */
  consecutiveFailures: number
  latency: {
    samples: number
    avgMs: number | null
    p50Ms: number | null
    p95Ms: number | null
    p99Ms: number | null
    maxMs: number | null
  }
  /** Status-code histogram, e.g. `{ "200": 41, "500": 3, "none": 2 }`. */
  statusCodes: Record<string, number>
  /** Per-endpoint rollup, sorted by unhealthyRate desc then total desc. */
  byEndpoint: EndpointSummary[]
  window: { from: string | null; to: string | null }
  deadLetter: {
    /** Attempts flagged as dead-lettered (explicit marker or exhausted retries). */
    attempts: number
    /** Distinct event ids among dead-lettered attempts. */
    events: number
    /** The flagged attempts themselves, in log order. */
    items: DeliveryAttempt[]
  }
}

export type AlertSeverity = "warning" | "critical"

export type MonitoringAlert = {
  rule: string
  severity: AlertSeverity
  message: string
  observed: number
  threshold: number
}

export type MonitoringThresholds = {
  /**
   * Minimum attempts required before rate/latency alerts are evaluated.
   * Below this the sample is too small to be meaningful — alerts are
   * suppressed (see {@link evaluateAlerts}).
   */
  minAttempts: number
  /** Unhealthy-rate (failure+error share) that raises a warning. */
  unhealthyRateWarning: number
  /** Unhealthy-rate that raises a critical alert. */
  unhealthyRateCritical: number
  /** p95 latency (ms) warning threshold. */
  p95LatencyMsWarning: number
  /** p99 latency (ms) warning threshold. */
  p99LatencyMsWarning: number
  /** Trailing consecutive non-success attempts that warn. */
  consecutiveFailuresWarning: number
  /**
   * Dead-lettered attempts tolerated before alerting. Default 0: any
   * dead-lettered delivery means retries were exhausted and the event needs
   * operator attention (replay or fix the receiver).
   */
  deadLetteredMax: number
  /**
   * Attempt number at/above which a failed attempt is treated as
   * dead-lettered even without an explicit marker. Mirrors the retry
   * policy's max attempts.
   */
  maxAttempts: number
}

export const DEFAULT_THRESHOLDS: MonitoringThresholds = {
  minAttempts: 20,
  unhealthyRateWarning: 0.05,
  unhealthyRateCritical: 0.2,
  p95LatencyMsWarning: 2_000,
  p99LatencyMsWarning: 5_000,
  consecutiveFailuresWarning: 5,
  deadLetteredMax: 0,
  maxAttempts: 5,
}

/* ------------------------------------------------------------------ */
/* Parsing                                                             */
/* ------------------------------------------------------------------ */

function firstString(record: DeliveryAttemptInput, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === "string" && value.length > 0) return value
  }
  return undefined
}

function firstNumber(record: DeliveryAttemptInput, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === "number" && Number.isFinite(value)) return value
    if (typeof value === "string" && value.trim() !== "") {
      const parsed = Number(value)
      if (Number.isFinite(parsed)) return parsed
    }
  }
  return undefined
}

function firstBoolean(record: DeliveryAttemptInput, keys: string[]): boolean | undefined {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === "boolean") return value
    if (value === "true" || value === 1) return true
    if (value === "false" || value === 0) return false
  }
  return undefined
}

/**
 * Normalize one raw log record into a {@link DeliveryAttempt}.
 * Returns `null` for records without a parseable timestamp — undated lines
 * cannot be windowed or ordered, so they are dropped (and counted by callers
 * that care, e.g. the report script).
 */
export function parseDeliveryAttempt(input: unknown): DeliveryAttempt | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return null
  const record = input as DeliveryAttemptInput

  const ts = firstString(record, ["ts", "timestamp", "time", "at", "datetime"])
  if (!ts || Number.isNaN(Date.parse(ts))) return null

  const status = firstNumber(record, ["status", "statusCode", "status_code", "httpStatus"])
  const attempt: DeliveryAttempt = { ts: new Date(ts).toISOString() }

  const eventId = firstString(record, ["eventId", "event_id", "event", "id"])
  if (eventId) attempt.eventId = eventId

  const endpoint = firstString(record, ["endpoint", "url", "target", "receiver"])
  if (endpoint) attempt.endpoint = endpoint

  const attemptNum = firstNumber(record, ["attempt", "attemptNumber", "attempt_number", "retry"])
  if (attemptNum !== undefined) attempt.attempt = Math.trunc(attemptNum)

  if (status !== undefined) {
    // Guard against junk like status: "abc" slipping through firstNumber's
    // string path only when it parses; also drop non-HTTP-range values.
    if (status >= 100 && status <= 599) attempt.status = Math.trunc(status)
  }

  const latencyMs = firstNumber(record, [
    "latencyMs",
    "latency_ms",
    "durationMs",
    "duration_ms",
    "elapsedMs",
    "elapsed_ms",
  ])
  if (latencyMs !== undefined && latencyMs >= 0) attempt.latencyMs = latencyMs

  const error = firstString(record, ["error", "errorMessage", "error_message", "err"])
  if (error) attempt.error = error

  const deadLettered = firstBoolean(record, [
    "deadLettered",
    "dead_lettered",
    "deadLetter",
    "dead_letter",
    "dlq",
  ])
  if (deadLettered !== undefined) attempt.deadLettered = deadLettered

  return attempt
}

/** Parse an NDJSON/JSON-lines blob into attempts, dropping invalid lines. */
export function parseDeliveryLog(text: string): {
  attempts: DeliveryAttempt[]
  skippedLines: number
} {
  const attempts: DeliveryAttempt[] = []
  let skippedLines = 0
  for (const line of text.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed) continue
    let json: unknown
    try {
      json = JSON.parse(trimmed)
    } catch {
      skippedLines += 1
      continue
    }
    const attempt = parseDeliveryAttempt(json)
    if (attempt) attempts.push(attempt)
    else skippedLines += 1
  }
  return { attempts, skippedLines }
}

/* ------------------------------------------------------------------ */
/* Analysis                                                            */
/* ------------------------------------------------------------------ */

/**
 * Classify an attempt:
 *  - `success` — 2xx HTTP status, no transport error;
 *  - `failure` — a non-2xx HTTP status came back;
 *  - `error`   — no HTTP status at all (timeout, DNS, reset).
 */
export function classifyOutcome(attempt: DeliveryAttempt): DeliveryOutcome {
  if (attempt.status === undefined) return "error"
  if (attempt.status >= 200 && attempt.status < 300 && !attempt.error) return "success"
  return "failure"
}

/**
 * Dead-letter detection. An attempt is dead-lettered when:
 *  - it carries an explicit marker (`deadLettered`/`dlq`), or
 *  - it failed at `attempt >= maxAttempts` — i.e. the retry budget is
 *    exhausted and the sender gives up.
 */
export function isDeadLettered(
  attempt: DeliveryAttempt,
  maxAttempts: number = DEFAULT_THRESHOLDS.maxAttempts,
): boolean {
  if (attempt.deadLettered === true) return true
  if (attempt.deadLettered === false) return false
  const outcome = classifyOutcome(attempt)
  return outcome !== "success" && attempt.attempt !== undefined && attempt.attempt >= maxAttempts
}

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null
  const idx = (p / 100) * (sorted.length - 1)
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  if (lo === hi) return sorted[lo] ?? null
  const low = sorted[lo] ?? 0
  const high = sorted[hi] ?? low
  return low + (high - low) * (idx - lo)
}

function summarizeEndpoint(endpoint: string, attempts: DeliveryAttempt[]): EndpointSummary {
  let success = 0
  let failure = 0
  let error = 0
  const latencies: number[] = []
  for (const a of attempts) {
    const outcome = classifyOutcome(a)
    if (outcome === "success") success += 1
    else if (outcome === "failure") failure += 1
    else error += 1
    if (a.latencyMs !== undefined) latencies.push(a.latencyMs)
  }
  latencies.sort((x, y) => x - y)
  const total = attempts.length
  return {
    endpoint,
    total,
    success,
    failure,
    error,
    unhealthyRate: total === 0 ? 0 : (failure + error) / total,
    p50LatencyMs: percentile(latencies, 50),
    p95LatencyMs: percentile(latencies, 95),
  }
}

/**
 * Aggregate delivery attempts into a {@link DeliverySummary}.
 * Attempts are analyzed in the order given; callers that want chronological
 * semantics should sort by `ts` first ({@link sortAttemptsByTs}).
 */
export function summarizeDeliveries(
  attempts: readonly DeliveryAttempt[],
  options: { maxAttempts?: number } = {},
): DeliverySummary {
  const maxAttempts = options.maxAttempts ?? DEFAULT_THRESHOLDS.maxAttempts

  let success = 0
  let failure = 0
  let error = 0
  const latencies: number[] = []
  const statusCodes: Record<string, number> = {}
  const byEndpointMap = new Map<string, DeliveryAttempt[]>()
  const deadLetterItems: DeliveryAttempt[] = []
  const deadLetterEventIds = new Set<string>()
  let from: string | null = null
  let to: string | null = null

  for (const attempt of attempts) {
    const outcome = classifyOutcome(attempt)
    if (outcome === "success") success += 1
    else if (outcome === "failure") failure += 1
    else error += 1

    if (attempt.latencyMs !== undefined) latencies.push(attempt.latencyMs)

    const statusKey = attempt.status === undefined ? "none" : String(attempt.status)
    statusCodes[statusKey] = (statusCodes[statusKey] ?? 0) + 1

    const endpoint = attempt.endpoint ?? "(unknown)"
    const bucket = byEndpointMap.get(endpoint)
    if (bucket) bucket.push(attempt)
    else byEndpointMap.set(endpoint, [attempt])

    if (isDeadLettered(attempt, maxAttempts)) {
      deadLetterItems.push(attempt)
      if (attempt.eventId) deadLetterEventIds.add(attempt.eventId)
    }

    if (from === null || attempt.ts < from) from = attempt.ts
    if (to === null || attempt.ts > to) to = attempt.ts
  }

  latencies.sort((x, y) => x - y)

  // Trailing streak of non-success attempts, walking backwards from the end.
  let consecutiveFailures = 0
  for (let i = attempts.length - 1; i >= 0; i -= 1) {
    if (classifyOutcome(attempts[i] as DeliveryAttempt) === "success") break
    consecutiveFailures += 1
  }

  const total = attempts.length
  const unhealthy = failure + error

  const byEndpoint = [...byEndpointMap.entries()]
    .map(([endpoint, list]) => summarizeEndpoint(endpoint, list))
    .sort(
      (a, b) =>
        b.unhealthyRate - a.unhealthyRate ||
        b.total - a.total ||
        a.endpoint.localeCompare(b.endpoint),
    )

  return {
    total,
    success,
    failure,
    error,
    unhealthyRate: total === 0 ? 0 : unhealthy / total,
    successRate: total === 0 ? 0 : success / total,
    consecutiveFailures,
    latency: {
      samples: latencies.length,
      avgMs:
        latencies.length === 0 ? null : latencies.reduce((sum, v) => sum + v, 0) / latencies.length,
      p50Ms: percentile(latencies, 50),
      p95Ms: percentile(latencies, 95),
      p99Ms: percentile(latencies, 99),
      maxMs: latencies.length === 0 ? null : (latencies[latencies.length - 1] ?? null),
    },
    statusCodes,
    byEndpoint,
    window: { from, to },
    deadLetter: {
      attempts: deadLetterItems.length,
      events: deadLetterEventIds.size,
      items: deadLetterItems,
    },
  }
}

/** Chronological sort helper (ISO-8601 strings sort lexicographically). */
export function sortAttemptsByTs(attempts: readonly DeliveryAttempt[]): DeliveryAttempt[] {
  return [...attempts].sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0))
}

/* ------------------------------------------------------------------ */
/* Alert evaluation                                                    */
/* ------------------------------------------------------------------ */

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`
}

/**
 * Evaluate a {@link DeliverySummary} against {@link MonitoringThresholds}.
 *
 * Rate and latency rules are suppressed when `total < minAttempts` — a tiny
 * sample produces noisy alerts. The consecutive-failure and dead-letter rules
 * always evaluate because a streak or a dead-letter is meaningful at any
 * volume.
 */
export function evaluateAlerts(
  summary: DeliverySummary,
  thresholds: MonitoringThresholds = DEFAULT_THRESHOLDS,
): MonitoringAlert[] {
  const alerts: MonitoringAlert[] = []
  const enoughVolume = summary.total >= thresholds.minAttempts

  if (enoughVolume) {
    if (summary.unhealthyRate >= thresholds.unhealthyRateCritical) {
      alerts.push({
        rule: "unhealthy-rate",
        severity: "critical",
        message:
          `Unhealthy delivery rate ${pct(summary.unhealthyRate)} ` +
          `(${summary.failure} HTTP failures + ${summary.error} transport errors ` +
          `of ${summary.total} attempts) exceeds critical threshold ${pct(thresholds.unhealthyRateCritical)}.`,
        observed: summary.unhealthyRate,
        threshold: thresholds.unhealthyRateCritical,
      })
    } else if (summary.unhealthyRate >= thresholds.unhealthyRateWarning) {
      alerts.push({
        rule: "unhealthy-rate",
        severity: "warning",
        message:
          `Unhealthy delivery rate ${pct(summary.unhealthyRate)} ` +
          `exceeds warning threshold ${pct(thresholds.unhealthyRateWarning)}.`,
        observed: summary.unhealthyRate,
        threshold: thresholds.unhealthyRateWarning,
      })
    }

    if (summary.latency.p95Ms !== null && summary.latency.p95Ms >= thresholds.p95LatencyMsWarning) {
      alerts.push({
        rule: "latency-p95",
        severity: "warning",
        message:
          `p95 delivery latency ${summary.latency.p95Ms}ms exceeds ` +
          `${thresholds.p95LatencyMsWarning}ms.`,
        observed: summary.latency.p95Ms,
        threshold: thresholds.p95LatencyMsWarning,
      })
    }

    if (summary.latency.p99Ms !== null && summary.latency.p99Ms >= thresholds.p99LatencyMsWarning) {
      alerts.push({
        rule: "latency-p99",
        severity: "warning",
        message:
          `p99 delivery latency ${summary.latency.p99Ms}ms exceeds ` +
          `${thresholds.p99LatencyMsWarning}ms.`,
        observed: summary.latency.p99Ms,
        threshold: thresholds.p99LatencyMsWarning,
      })
    }
  }

  if (summary.consecutiveFailures >= thresholds.consecutiveFailuresWarning) {
    alerts.push({
      rule: "consecutive-failures",
      severity: "warning",
      message:
        `Trailing streak of ${summary.consecutiveFailures} consecutive ` +
        `non-success deliveries (threshold ${thresholds.consecutiveFailuresWarning}). ` +
        `The receiver may be down.`,
      observed: summary.consecutiveFailures,
      threshold: thresholds.consecutiveFailuresWarning,
    })
  }

  if (summary.deadLetter.attempts > thresholds.deadLetteredMax) {
    alerts.push({
      rule: "dead-lettered",
      severity: "critical",
      message:
        `${summary.deadLetter.attempts} delivery attempt(s) across ` +
        `${summary.deadLetter.events} event(s) were dead-lettered ` +
        `(retries exhausted or explicitly marked). Inspect and replay or fix ` +
        `the receiver.`,
      observed: summary.deadLetter.attempts,
      threshold: thresholds.deadLetteredMax,
    })
  }

  return alerts
}

/* ------------------------------------------------------------------ */
/* Demo data                                                           */
/* ------------------------------------------------------------------ */

/**
 * Deterministic demo corpus for `report.mjs --demo` and manual exploration.
 *
 * Produces ~120 attempts over a synthetic 30-minute window that exercise
 * every code path: healthy traffic, an HTTP 5xx burst, transport timeouts,
 * high-latency tail, and one event whose retries are exhausted (dead-letter).
 * Uses a tiny mulberry32 PRNG so output is stable across runs.
 */
export function demoDeliveryAttempts(baseTime?: string): DeliveryAttempt[] {
  const start = baseTime ? Date.parse(baseTime) : Date.parse("2026-11-20T04:00:00.000Z")
  let seed = 0x9e3779b9
  const rand = () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  const endpoints = [
    "https://hooks.example.com/newsletter",
    "https://hooks.example.com/contacts",
    "https://hooks.example.com/feedback",
  ]
  const attempts: DeliveryAttempt[] = []
  let eventCounter = 0
  const nextEventId = () => `evt_demo_${String(++eventCounter).padStart(4, "0")}`

  // Phase 1 (first ~18 min): mostly healthy traffic, occasional 500/timeout.
  for (let i = 0; i < 90; i += 1) {
    const ts = new Date(start + i * 12_000).toISOString()
    const roll = rand()
    const base: DeliveryAttempt = {
      ts,
      eventId: nextEventId(),
      endpoint: endpoints[i % endpoints.length],
      attempt: 1,
    }
    if (roll < 0.82) {
      attempts.push({ ...base, status: 200, latencyMs: Math.round(40 + rand() * 160) })
    } else if (roll < 0.9) {
      // Retryable HTTP failure, then a later attempt succeeds.
      attempts.push({ ...base, status: 503, latencyMs: Math.round(300 + rand() * 400) })
      attempts.push({
        ...base,
        ts: new Date(Date.parse(ts) + 30_000).toISOString(),
        attempt: 2,
        status: 200,
        latencyMs: Math.round(60 + rand() * 200),
      })
    } else if (roll < 0.95) {
      attempts.push({ ...base, status: undefined, error: "ETIMEDOUT", latencyMs: 10_000 })
    } else {
      // Slow tail: drives p95/p99 up in the last third of the window.
      attempts.push({
        ...base,
        status: 200,
        latencyMs: Math.round(2_500 + rand() * 3_500),
      })
    }
  }

  // Phase 2 (last ~12 min): sustained 502s + timeouts → alert territory,
  // ending in a dead-lettered event.
  const deadEvent = nextEventId()
  for (let i = 0; i < 5; i += 1) {
    const ts = new Date(start + (90 + i) * 12_000).toISOString()
    attempts.push({
      ts,
      eventId: deadEvent,
      endpoint: endpoints[0],
      attempt: i + 1,
      status: i === 4 ? undefined : 502,
      latencyMs: Math.round(800 + rand() * 900),
      ...(i === 4 ? { error: "ECONNRESET" } : {}),
      deadLettered: i === 4,
    })
  }
  for (let i = 0; i < 10; i += 1) {
    const ts = new Date(start + (95 + i) * 12_000).toISOString()
    const roll = rand()
    attempts.push({
      ts,
      eventId: nextEventId(),
      endpoint: endpoints[1],
      attempt: 1,
      status: roll < 0.5 ? 502 : roll < 0.8 ? undefined : 200,
      latencyMs: roll < 0.8 ? 10_000 : Math.round(100 + rand() * 300),
      ...(roll >= 0.5 && roll < 0.8 ? { error: "socket hang up" } : {}),
    })
  }

  return sortAttemptsByTs(attempts)
}
