/**
 * API analytics over `api.request` log records.
 *
 * This module is the "deep analytics" half of API observability: where
 * scripts/metrics/log-metrics.mjs answers "what is the request/error rate
 * right now", this module answers longitudinal questions — per-endpoint
 * request volume over time, error-budget burn, who is calling (users and
 * projects), whether an endpoint is new or established, and whether latency
 * is regressing.
 *
 * Everything here is a pure function over already-parsed JSON log objects
 * shaped like the summary line emitted by src/lib/request-logging.ts:
 *
 *   { event: "api.request", time, method, path, status, durationMs,
 *     userId, projectId }
 *
 * No I/O, no clocks beyond the records' own timestamps, no dependencies —
 * safe for unit tests and for reuse from scripts/analytics/api/analyze.mjs.
 */

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

/** A single `api.request` summary line, parsed from JSON. Fields are all
 * optional because log lines in the wild may predate a field or carry nulls
 * (anonymous requests log `userId: null`, `projectId: null`). */
export type ApiRequestRecord = {
  event?: unknown
  time?: unknown
  method?: unknown
  path?: unknown
  status?: unknown
  durationMs?: unknown
  userId?: unknown
  projectId?: unknown
}

/** Normalized request used by all aggregations. */
export type NormalizedRequest = {
  time: number // epoch ms
  method: string
  path: string
  status: number
  durationMs: number | null
  userId: string | null
  projectId: string | null
}

export type ApiAnalyticsOptions = {
  /** Bucket width for per-endpoint time series. Default 24h. */
  bucketMs?: number
  /** Trailing window used to classify an endpoint as "new". Default 7d. */
  newEndpointWindowMs?: number
  /** Allowed error ratio for error-budget burn (0–1). Default 0.01 (1%). */
  errorBudgetRate?: number
  /** p95 regression factor that triggers a latency anomaly. Default 1.5×. */
  latencyRegressionFactor?: number
  /** Minimum absolute p95 increase (ms) required alongside the factor.
   * Default 25ms so sub-millisecond endpoints don't false-positive. */
  latencyRegressionMinMs?: number
  /** Minimum requests in the recent half before regression detection runs.
   * Default 10. */
  minRecentRequests?: number
  /** Error-rate ratio over baseline that triggers an error anomaly.
   * Default 3×. */
  errorSpikeFactor?: number
  /** Minimum requests in the recent half for error-spike detection. Default 10. */
  minRecentRequestsForErrors?: number
}

const DEFAULTS: Required<ApiAnalyticsOptions> = {
  bucketMs: 24 * 60 * 60 * 1000,
  newEndpointWindowMs: 7 * 24 * 60 * 60 * 1000,
  errorBudgetRate: 0.01,
  latencyRegressionFactor: 1.5,
  latencyRegressionMinMs: 25,
  minRecentRequests: 10,
  errorSpikeFactor: 3,
  minRecentRequestsForErrors: 10,
}

// ---------------------------------------------------------------------------
// Parsing / normalization
// ---------------------------------------------------------------------------

export const API_REQUEST_EVENT = "api.request"

export function isApiRequestRecord(record: unknown): record is ApiRequestRecord {
  return (
    record !== null &&
    typeof record === "object" &&
    !Array.isArray(record) &&
    (record as ApiRequestRecord).event === API_REQUEST_EVENT
  )
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value)
    return Number.isFinite(n) ? n : null
  }
  return null
}

function toTimeMs(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string") {
    const parsed = Date.parse(value)
    if (Number.isFinite(parsed)) return parsed
    const n = Number(value)
    if (Number.isFinite(n)) return n
  }
  return null
}

function toId(value: unknown): string | null {
  if (typeof value === "string" && value !== "") return value
  if (typeof value === "number" && Number.isFinite(value)) return String(value)
  return null
}

/** Normalizes one parsed log record; returns null when it lacks the minimum
 * needed fields (timestamp + path). */
export function normalizeRequest(record: ApiRequestRecord): NormalizedRequest | null {
  const time = toTimeMs(record.time)
  const path = typeof record.path === "string" && record.path !== "" ? record.path : null
  if (time === null || path === null) return null

  return {
    time,
    method: typeof record.method === "string" && record.method !== "" ? record.method : "UNKNOWN",
    path,
    status: toFiniteNumber(record.status) ?? 0,
    durationMs: toFiniteNumber(record.durationMs),
    userId: toId(record.userId),
    projectId: toId(record.projectId),
  }
}

/** Filters + normalizes a mixed stream of parsed records into requests. */
export function collectRequests(records: Iterable<unknown>): NormalizedRequest[] {
  const requests: NormalizedRequest[] = []
  for (const record of records) {
    if (!isApiRequestRecord(record)) continue
    const normalized = normalizeRequest(record)
    if (normalized) requests.push(normalized)
  }
  return requests
}

// ---------------------------------------------------------------------------
// Small stats helpers
// ---------------------------------------------------------------------------

export function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null
  if (sorted.length === 1) return sorted[0]
  const rank = (p / 100) * (sorted.length - 1)
  const lo = Math.floor(rank)
  const hi = Math.ceil(rank)
  if (lo === hi) return sorted[lo]
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (rank - lo)
}

function round(n: number | null, digits = 1): number | null {
  if (n === null || !Number.isFinite(n)) return null
  const f = 10 ** digits
  return Math.round(n * f) / f
}

function endpointKey(method: string, path: string): string {
  return `${method} ${path}`
}

function isError(status: number): boolean {
  return status >= 400
}

// ---------------------------------------------------------------------------
// Report types
// ---------------------------------------------------------------------------

export type EndpointSummary = {
  method: string
  path: string
  requests: number
  errors: number
  errorRate: number
  avgDurationMs: number | null
  p50DurationMs: number | null
  p95DurationMs: number | null
  firstSeen: string | null
  lastSeen: string | null
  activeUsers: number
  activeProjects: number
  /** True when the endpoint's first request falls inside the trailing
   * newEndpointWindowMs measured from the latest request in the dataset. */
  isNew: boolean
  errorBudget: {
    /** Configured allowed error ratio (e.g. 0.01 = 1%). */
    allowedRate: number
    /** observed errorRate / allowedRate. >1 means the budget is exhausted. */
    burnRate: number
    /** Errors per day at the observed rate — how fast budget is consumed. */
    errorsPerDay: number | null
  }
}

export type TimeSeriesPoint = {
  endpoint: string // "METHOD path"
  bucketStart: string // ISO
  requests: number
  errors: number
}

export type ActorSummary = {
  id: string // userId or projectId, or "(anonymous)"
  requests: number
  errors: number
  errorRate: number
  avgDurationMs: number | null
  p95DurationMs: number | null
  /** Distinct counterpart ids (projects for users, users for projects). */
  relatedCount: number
  firstSeen: string | null
  lastSeen: string | null
}

export type ApiAnomaly = {
  type: "latency_regression" | "error_rate_spike"
  endpoint: string
  severity: "warning" | "critical"
  detail: string
  baseline: { p95Ms?: number | null; errorRate?: number }
  recent: { p95Ms?: number | null; errorRate?: number; requests: number }
}

export type ApiAnalyticsReport = {
  window: {
    first: string | null
    last: string | null
    seconds: number | null
    requests: number
    errors: number
    errorRate: number
    uniqueUsers: number
    uniqueProjects: number
  }
  endpoints: EndpointSummary[]
  timeSeries: TimeSeriesPoint[]
  topUsers: ActorSummary[]
  topProjects: ActorSummary[]
  newEndpoints: string[]
  anomalies: ApiAnomaly[]
  options: Required<ApiAnalyticsOptions>
}

// ---------------------------------------------------------------------------
// Core analysis
// ---------------------------------------------------------------------------

export function analyzeApiRequests(
  input: Iterable<unknown>,
  options: ApiAnalyticsOptions = {},
): ApiAnalyticsReport {
  const opts: Required<ApiAnalyticsOptions> = { ...DEFAULTS, ...options }
  const requests = collectRequests(input)
  return buildReport(requests, opts)
}

function buildReport(
  requests: NormalizedRequest[],
  opts: Required<ApiAnalyticsOptions>,
): ApiAnalyticsReport {
  if (requests.length === 0) {
    return {
      window: {
        first: null,
        last: null,
        seconds: null,
        requests: 0,
        errors: 0,
        errorRate: 0,
        uniqueUsers: 0,
        uniqueProjects: 0,
      },
      endpoints: [],
      timeSeries: [],
      topUsers: [],
      topProjects: [],
      newEndpoints: [],
      anomalies: [],
      options: opts,
    }
  }

  const times = requests.map((r) => r.time)
  const first = Math.min(...times)
  const last = Math.max(...times)
  const windowMs = Math.max(1, last - first)

  // ---- Per-endpoint aggregation -----------------------------------------
  type EndpointAcc = {
    method: string
    path: string
    requests: number
    errors: number
    durations: number[]
    users: Set<string>
    projects: Set<string>
    firstSeen: number
    lastSeen: number
    durationsByHalf: { baseline: number[]; recent: number[] }
    errorsByHalf: { baseline: number; recent: number }
    requestsByHalf: { baseline: number; recent: number }
  }

  const mid = first + windowMs / 2
  const endpoints = new Map<string, EndpointAcc>()

  const endpointFor = (r: NormalizedRequest) => {
    const key = endpointKey(r.method, r.path)
    let acc = endpoints.get(key)
    if (!acc) {
      acc = {
        method: r.method,
        path: r.path,
        requests: 0,
        errors: 0,
        durations: [],
        users: new Set(),
        projects: new Set(),
        firstSeen: r.time,
        lastSeen: r.time,
        durationsByHalf: { baseline: [], recent: [] },
        errorsByHalf: { baseline: 0, recent: 0 },
        requestsByHalf: { baseline: 0, recent: 0 },
      }
      endpoints.set(key, acc)
    }
    return acc
  }

  for (const r of requests) {
    const ep = endpointFor(r)
    ep.requests += 1
    ep.firstSeen = Math.min(ep.firstSeen, r.time)
    ep.lastSeen = Math.max(ep.lastSeen, r.time)
    if (r.userId) ep.users.add(r.userId)
    if (r.projectId) ep.projects.add(r.projectId)
    if (r.durationMs !== null) ep.durations.push(r.durationMs)

    const half = r.time <= mid ? "baseline" : "recent"
    ep.requestsByHalf[half] += 1
    if (isError(r.status)) ep.errorsByHalf[half] += 1
    if (r.durationMs !== null) ep.durationsByHalf[half].push(r.durationMs)
    if (isError(r.status)) ep.errors += 1
  }

  const daysInWindow = windowMs / (24 * 60 * 60 * 1000)
  const endpointSummaries: EndpointSummary[] = [...endpoints.values()]
    .map((ep) => {
      const sorted = [...ep.durations].sort((a, b) => a - b)
      const errorRate = ep.requests > 0 ? ep.errors / ep.requests : 0
      return {
        method: ep.method,
        path: ep.path,
        requests: ep.requests,
        errors: ep.errors,
        errorRate: round(errorRate, 4) ?? 0,
        avgDurationMs: round(
          ep.durations.length
            ? ep.durations.reduce((a, b) => a + b, 0) / ep.durations.length
            : null,
        ),
        p50DurationMs: round(percentile(sorted, 50)),
        p95DurationMs: round(percentile(sorted, 95)),
        firstSeen: new Date(ep.firstSeen).toISOString(),
        lastSeen: new Date(ep.lastSeen).toISOString(),
        activeUsers: ep.users.size,
        activeProjects: ep.projects.size,
        isNew: ep.firstSeen >= last - opts.newEndpointWindowMs,
        errorBudget: {
          allowedRate: opts.errorBudgetRate,
          burnRate:
            opts.errorBudgetRate > 0 ? (round(errorRate / opts.errorBudgetRate, 2) ?? 0) : 0,
          errorsPerDay: daysInWindow > 0 ? round(ep.errors / daysInWindow, 2) : null,
        },
      }
    })
    .sort((a, b) => b.requests - a.requests || a.path.localeCompare(b.path))

  // ---- Per-endpoint time series ------------------------------------------
  const timeSeries = buildTimeSeries(requests, opts.bucketMs)

  // ---- Top users / projects ----------------------------------------------
  const topUsers = buildActorSummaries(requests, "userId", 20)
  const topProjects = buildActorSummaries(requests, "projectId", 20)

  // ---- New vs returning ----------------------------------------------------
  const newEndpoints = endpointSummaries
    .filter((ep) => ep.isNew)
    .map((ep) => endpointKey(ep.method, ep.path))

  // ---- Anomaly detection ----------------------------------------------------
  const anomalies = detectAnomalies(endpoints, opts)

  const uniqueUsers = new Set(requests.map((r) => r.userId).filter(Boolean))
  const uniqueProjects = new Set(requests.map((r) => r.projectId).filter(Boolean))
  const totalErrors = requests.filter((r) => isError(r.status)).length

  return {
    window: {
      first: new Date(first).toISOString(),
      last: new Date(last).toISOString(),
      seconds: round((last - first) / 1000, 1),
      requests: requests.length,
      errors: totalErrors,
      errorRate: round(requests.length ? totalErrors / requests.length : 0, 4) ?? 0,
      uniqueUsers: uniqueUsers.size,
      uniqueProjects: uniqueProjects.size,
    },
    endpoints: endpointSummaries,
    timeSeries,
    topUsers,
    topProjects,
    newEndpoints,
    anomalies,
    options: opts,
  }
}

function buildTimeSeries(requests: NormalizedRequest[], bucketMs: number): TimeSeriesPoint[] {
  const bucketWidth = Math.max(1, bucketMs)
  const points = new Map<string, TimeSeriesPoint>()
  for (const r of requests) {
    const bucketStart = Math.floor(r.time / bucketWidth) * bucketWidth
    const ep = endpointKey(r.method, r.path)
    const key = `${ep}|${bucketStart}`
    let point = points.get(key)
    if (!point) {
      point = {
        endpoint: ep,
        bucketStart: new Date(bucketStart).toISOString(),
        requests: 0,
        errors: 0,
      }
      points.set(key, point)
    }
    point.requests += 1
    if (isError(r.status)) point.errors += 1
  }
  return [...points.values()].sort(
    (a, b) => a.endpoint.localeCompare(b.endpoint) || a.bucketStart.localeCompare(b.bucketStart),
  )
}

function buildActorSummaries(
  requests: NormalizedRequest[],
  field: "userId" | "projectId",
  limit: number,
): ActorSummary[] {
  const otherField = field === "userId" ? "projectId" : "userId"
  type Acc = {
    id: string
    requests: number
    errors: number
    durations: number[]
    related: Set<string>
    firstSeen: number
    lastSeen: number
  }
  const actors = new Map<string, Acc>()

  for (const r of requests) {
    const id = r[field]
    const key = id ?? "(anonymous)"
    let acc = actors.get(key)
    if (!acc) {
      acc = {
        id: key,
        requests: 0,
        errors: 0,
        durations: [],
        related: new Set(),
        firstSeen: r.time,
        lastSeen: r.time,
      }
      actors.set(key, acc)
    }
    acc.requests += 1
    acc.firstSeen = Math.min(acc.firstSeen, r.time)
    acc.lastSeen = Math.max(acc.lastSeen, r.time)
    if (isError(r.status)) acc.errors += 1
    if (r.durationMs !== null) acc.durations.push(r.durationMs)
    const other = r[otherField]
    if (other) acc.related.add(other)
  }

  return [...actors.values()]
    .map((acc) => {
      const sorted = [...acc.durations].sort((a, b) => a - b)
      return {
        id: acc.id,
        requests: acc.requests,
        errors: acc.errors,
        errorRate: round(acc.requests ? acc.errors / acc.requests : 0, 4) ?? 0,
        avgDurationMs: round(
          acc.durations.length
            ? acc.durations.reduce((a, b) => a + b, 0) / acc.durations.length
            : null,
        ),
        p95DurationMs: round(percentile(sorted, 95)),
        relatedCount: acc.related.size,
        firstSeen: new Date(acc.firstSeen).toISOString(),
        lastSeen: new Date(acc.lastSeen).toISOString(),
      }
    })
    .sort((a, b) => b.requests - a.requests || a.id.localeCompare(b.id))
    .slice(0, limit)
}

// ---------------------------------------------------------------------------
// Anomaly detection
// ---------------------------------------------------------------------------

/**
 * Compares the recent half of the window against the baseline half per
 * endpoint. Emits anomalies for:
 *  - latency_regression: recent p95 > baseline p95 × factor AND delta ≥ minMs
 *  - error_rate_spike:   recent error rate > baseline × factor (with a
 *                        minimum absolute rate of 1% to avoid noise on tiny
 *                        denominators)
 * Severity is "critical" when the recent value is ≥ 2× the trigger threshold.
 */
export function detectAnomalies(
  endpoints: Map<
    string,
    {
      method: string
      path: string
      durationsByHalf: { baseline: number[]; recent: number[] }
      errorsByHalf: { baseline: number; recent: number }
      requestsByHalf: { baseline: number; recent: number }
    }
  >,
  opts: Required<ApiAnalyticsOptions>,
): ApiAnomaly[] {
  const anomalies: ApiAnomaly[] = []

  for (const ep of endpoints.values()) {
    const endpoint = endpointKey(ep.method, ep.path)

    // Latency regression
    const baseSorted = [...ep.durationsByHalf.baseline].sort((a, b) => a - b)
    const recentSorted = [...ep.durationsByHalf.recent].sort((a, b) => a - b)
    const baseP95 = percentile(baseSorted, 95)
    const recentP95 = percentile(recentSorted, 95)
    const recentN = ep.requestsByHalf.recent

    if (
      recentN >= opts.minRecentRequests &&
      baseP95 !== null &&
      recentP95 !== null &&
      baseP95 > 0 &&
      recentP95 >= baseP95 * opts.latencyRegressionFactor &&
      recentP95 - baseP95 >= opts.latencyRegressionMinMs
    ) {
      const ratio = recentP95 / baseP95
      anomalies.push({
        type: "latency_regression",
        endpoint,
        severity: ratio >= opts.latencyRegressionFactor * 2 ? "critical" : "warning",
        detail: `p95 latency regressed from ${round(baseP95)}ms to ${round(recentP95)}ms (${round(ratio, 2)}× baseline)`,
        baseline: { p95Ms: round(baseP95) },
        recent: { p95Ms: round(recentP95), requests: recentN },
      })
    }

    // Error-rate spike
    const baseErrRate =
      ep.requestsByHalf.baseline > 0 ? ep.errorsByHalf.baseline / ep.requestsByHalf.baseline : 0
    const recentErrRate =
      ep.requestsByHalf.recent > 0 ? ep.errorsByHalf.recent / ep.requestsByHalf.recent : 0
    const recentErrN = ep.errorsByHalf.recent

    const baselineFloor = Math.max(baseErrRate, 0.001) // avoid div-by-zero on clean endpoints
    if (
      recentErrN >= opts.minRecentRequestsForErrors &&
      recentErrRate >= baselineFloor * opts.errorSpikeFactor &&
      recentErrRate >= 0.01
    ) {
      const ratio = recentErrRate / baselineFloor
      anomalies.push({
        type: "error_rate_spike",
        endpoint,
        severity: ratio >= opts.errorSpikeFactor * 2 ? "critical" : "warning",
        detail: `error rate spiked from ${round(baseErrRate * 100, 2)}% to ${round(recentErrRate * 100, 2)}% (${round(ratio, 1)}× baseline)`,
        baseline: { errorRate: round(baseErrRate, 4) ?? 0 },
        recent: { errorRate: round(recentErrRate, 4) ?? 0, requests: recentErrN },
      })
    }
  }

  const rank = { critical: 0, warning: 1 }
  return anomalies.sort(
    (a, b) => rank[a.severity] - rank[b.severity] || a.endpoint.localeCompare(b.endpoint),
  )
}
