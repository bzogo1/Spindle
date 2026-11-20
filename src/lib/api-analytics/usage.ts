/**
 * Pure aggregation for `api.request` log lines.
 *
 * The request-logging wrapper (src/lib/request-logging.ts) emits exactly one
 * JSON summary line per API request with this shape:
 *
 *   {
 *     event: "api.request",
 *     requestId, method, path, status, durationMs,
 *     userId, projectId,          // null when unresolved
 *     error: { type, message },   // only on thrown errors
 *     time, level, msg, ...       // pino envelope
 *   }
 *
 * `aggregateApiUsage()` turns a stream of those records (already JSON-parsed)
 * into a usage report: per-endpoint counts and error rates, latency
 * percentiles, status distribution, and the top consumers by userId /
 * projectId. It has no I/O — scripts/analytics/api/usage.mjs feeds it parsed
 * lines and the tests feed it fixtures.
 */

export type ApiRequestRecord = {
  event?: unknown
  method?: unknown
  path?: unknown
  status?: unknown
  durationMs?: unknown
  userId?: unknown
  projectId?: unknown
  time?: unknown
  error?: unknown
  msg?: unknown
}

export type ApiUsageOptions = {
  /** Event name treated as an HTTP request summary. Default "api.request". */
  requestEvent?: string
  /** Rows kept in top-N tables (endpoints, users, projects, messages). */
  topN?: number
}

export type DurationSummary = {
  count: number
  min: number
  max: number
  avg: number
  p50: number
  p90: number
  p95: number
  p99: number
}

export type EndpointUsage = {
  method: string
  path: string
  count: number
  errors: number
  errorRate: number
  serverErrors: number
  clientErrors: number
  latency: DurationSummary | null
}

export type ConsumerUsage = {
  id: string
  count: number
  errors: number
  errorRate: number
  /** Fraction of all observed requests, 0..1. */
  share: number
}

export type ApiUsageReport = {
  requestEvent: string
  window: {
    first: string | null
    last: string | null
    seconds: number | null
  }
  lines: {
    /** Records that matched the request event. */
    requests: number
  }
  totals: {
    requests: number
    errors: number
    errorRate: number
    serverErrors: number
    clientErrors: number
    perSecond: number | null
  }
  latencyMs: DurationSummary | null
  statusDistribution: Record<string, number>
  endpoints: EndpointUsage[]
  endpointCount: number
  topUsers: ConsumerUsage[]
  topProjects: ConsumerUsage[]
  topErrorMessages: { message: string; count: number }[]
}

const DEFAULT_REQUEST_EVENT = "api.request"
const DEFAULT_TOP_N = 10

function round1(n: number) {
  return Math.round(n * 10) / 10
}

function round2(n: number) {
  return Math.round(n * 100) / 100
}

function round4(n: number) {
  return Math.round(n * 10000) / 10000
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value)
    return Number.isFinite(n) ? n : null
  }
  return null
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  if (sorted.length === 1) return sorted[0]
  const rank = (p / 100) * (sorted.length - 1)
  const lo = Math.floor(rank)
  const hi = Math.ceil(rank)
  if (lo === hi) return sorted[lo]
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (rank - lo)
}

export function summarizeDurations(values: number[]): DurationSummary | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const sum = sorted.reduce((acc, v) => acc + v, 0)
  return {
    count: sorted.length,
    min: round1(sorted[0]),
    max: round1(sorted[sorted.length - 1]),
    avg: round1(sum / sorted.length),
    p50: round1(percentile(sorted, 50)),
    p90: round1(percentile(sorted, 90)),
    p95: round1(percentile(sorted, 95)),
    p99: round1(percentile(sorted, 99)),
  }
}

function isErrorStatus(status: number) {
  return status >= 400
}

function isServerError(status: number) {
  return status >= 500
}

function errorMessage(record: ApiRequestRecord): string {
  const error = record.error
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === "string" && message !== "") return message
  }
  if (typeof record.msg === "string" && record.msg !== "") return record.msg
  return "(no message)"
}

function consumerId(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null
}

type MutableConsumer = {
  id: string
  count: number
  errors: number
}

type MutableEndpoint = {
  method: string
  path: string
  count: number
  errors: number
  serverErrors: number
  clientErrors: number
  durations: number[]
}

/**
 * Aggregates parsed `api.request` records into a usage report.
 * Non-request records are ignored for all metrics (only request records
 * contribute to the observed window).
 */
export function aggregateApiUsage(
  records: ApiRequestRecord[],
  options: ApiUsageOptions = {},
): ApiUsageReport {
  const requestEvent = options.requestEvent ?? DEFAULT_REQUEST_EVENT
  const topN =
    Number.isFinite(options.topN) && (options.topN ?? 0) > 0
      ? Math.floor(options.topN as number)
      : DEFAULT_TOP_N

  const requests = records.filter((r) => r.event === requestEvent)

  const durations: number[] = []
  const statusDistribution = new Map<number, number>()
  const endpoints = new Map<string, MutableEndpoint>()
  const users = new Map<string, MutableConsumer>()
  const projects = new Map<string, MutableConsumer>()
  const errorMessages = new Map<string, number>()

  let first: number | null = null
  let last: number | null = null
  let errors = 0
  let serverErrors = 0
  let clientErrors = 0

  const bumpConsumer = (map: Map<string, MutableConsumer>, id: string | null, failed: boolean) => {
    if (id === null) return
    let entry = map.get(id)
    if (!entry) {
      entry = { id, count: 0, errors: 0 }
      map.set(id, entry)
    }
    entry.count += 1
    if (failed) entry.errors += 1
  }

  for (const req of requests) {
    const method = String(req.method ?? "UNKNOWN").toUpperCase()
    const path = String(req.path ?? "UNKNOWN")
    const status = toNumber(req.status) ?? 0
    const duration = toNumber(req.durationMs)
    const failed = isErrorStatus(status)

    if (failed) {
      errors += 1
      if (isServerError(status)) serverErrors += 1
      else clientErrors += 1
    }

    statusDistribution.set(status, (statusDistribution.get(status) ?? 0) + 1)
    if (duration !== null) durations.push(duration)

    const key = `${method} ${path}`
    let ep = endpoints.get(key)
    if (!ep) {
      ep = { method, path, count: 0, errors: 0, serverErrors: 0, clientErrors: 0, durations: [] }
      endpoints.set(key, ep)
    }
    ep.count += 1
    if (failed) {
      ep.errors += 1
      if (isServerError(status)) ep.serverErrors += 1
      else ep.clientErrors += 1
      const message = errorMessage(req)
      errorMessages.set(message, (errorMessages.get(message) ?? 0) + 1)
    }
    if (duration !== null) ep.durations.push(duration)

    bumpConsumer(users, consumerId(req.userId), failed)
    bumpConsumer(projects, consumerId(req.projectId), failed)

    const time = Date.parse(typeof req.time === "string" ? req.time : "")
    if (Number.isFinite(time)) {
      if (first === null || time < first) first = time
      if (last === null || time > last) last = time
    }
  }

  const total = requests.length
  const windowSeconds =
    first !== null && last !== null && last > first ? (last - first) / 1000 : null

  const endpointList: EndpointUsage[] = [...endpoints.values()]
    .map((ep) => ({
      method: ep.method,
      path: ep.path,
      count: ep.count,
      errors: ep.errors,
      errorRate: ep.count > 0 ? round4(ep.errors / ep.count) : 0,
      serverErrors: ep.serverErrors,
      clientErrors: ep.clientErrors,
      latency: summarizeDurations(ep.durations),
    }))
    .sort(
      (a, b) =>
        b.count - a.count || a.path.localeCompare(b.path) || a.method.localeCompare(b.method),
    )

  const toConsumers = (map: Map<string, MutableConsumer>): ConsumerUsage[] =>
    [...map.values()]
      .map((c) => ({
        id: c.id,
        count: c.count,
        errors: c.errors,
        errorRate: c.count > 0 ? round4(c.errors / c.count) : 0,
        share: total > 0 ? round4(c.count / total) : 0,
      }))
      .sort((a, b) => b.count - a.count || a.id.localeCompare(b.id))
      .slice(0, topN)

  return {
    requestEvent,
    window: {
      first: first !== null ? new Date(first).toISOString() : null,
      last: last !== null ? new Date(last).toISOString() : null,
      seconds: windowSeconds !== null ? round1(windowSeconds) : null,
    },
    lines: { requests: total },
    totals: {
      requests: total,
      errors,
      errorRate: total > 0 ? round4(errors / total) : 0,
      serverErrors,
      clientErrors,
      perSecond: windowSeconds ? round2(total / windowSeconds) : null,
    },
    latencyMs: summarizeDurations(durations),
    statusDistribution: Object.fromEntries(
      [...statusDistribution.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([status, count]) => [String(status), count]),
    ),
    endpoints: endpointList.slice(0, topN),
    endpointCount: endpointList.length,
    topUsers: toConsumers(users),
    topProjects: toConsumers(projects),
    topErrorMessages: [...errorMessages.entries()]
      .map(([message, count]) => ({ message, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, topN),
  }
}
