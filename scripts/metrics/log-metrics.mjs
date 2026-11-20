#!/usr/bin/env node
/**
 * Log-based metrics for Spindle's pino JSON logs.
 *
 * Reads newline-delimited JSON log lines (the shape emitted by
 * src/lib/logger.ts + src/lib/request-logging.ts), derives metrics, and
 * renders them as a text summary, a JSON report, a markdown report, and/or a
 * Prometheus text exposition for scraping.
 *
 * Always computed from `api.request` summary lines (see request-logging.ts):
 *
 *   - request rate and total request count over the observed window
 *   - error rate by route and by HTTP status
 *   - latency percentiles (p50/p90/p95/p99) from `durationMs`
 *   - top error messages (from `error.message` on failed requests)
 *   - per-endpoint breakdown (method, path, status, count, error rate,
 *     average and p95 duration)
 *
 * Extra metrics come from scripts/metrics/log-metrics.config.json: each entry
 * names a metric and a `match` filter over JSON fields (dot paths supported),
 * plus `groupBy` labels and, for histograms, a numeric `value` field and
 * `buckets`. No jq, no queries — just field matching.
 *
 * Usage:
 *   node scripts/metrics/log-metrics.mjs --demo
 *   node scripts/metrics/log-metrics.mjs --file logs/app.log --format json
 *   node scripts/metrics/log-metrics.mjs --stdin --format prometheus
 *   node scripts/metrics/log-metrics.mjs --demo --format text,json,markdown
 *
 * Exit codes: 0 ok, 2 usage error.
 */

import { createReadStream } from "node:fs"
import { readFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import readline from "node:readline"
import { fileURLToPath } from "node:url"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, "../..")
const DEFAULT_CONFIG = resolve(scriptDir, "log-metrics.config.json")

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const HELP = `log-metrics.mjs — derive Prometheus-style metrics from pino JSON logs

Sources (pick one):
  --stdin              read lines from stdin (default when no source is given)
  --file <path>        read a file once ('-' reads stdin)
  --demo               feed built-in synthetic pino lines and exit

Output:
  --format <list>      comma-separated: text,json,markdown,prometheus
                       (default: text). prometheus prints a scrape-able
                       exposition; combine with the others freely.
  --config <path>      metric definitions file
                       (default: scripts/metrics/log-metrics.config.json)
  --top <n>            rows in top-error / per-endpoint tables (default: 10)
  --request-event <e>  event name treated as an HTTP request summary
                       (default: api.request, or config requestEvent)
  --help, -h           show this message

Environment overrides: none — this tool is intentionally dependency-free.

Exit codes: 0 ok, 2 usage error.`

function parseArgs(argv) {
  const options = { help: false, demo: false, stdin: false, file: null }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const next = () => argv[++i]
    switch (arg) {
      case "--help":
      case "-h":
        options.help = true
        break
      case "--demo":
        options.demo = true
        break
      case "--stdin":
        options.stdin = true
        break
      case "--file":
        options.file = next() ?? null
        break
      case "--format":
        options.format = next() ?? "text"
        break
      case "--config":
        options.config = next() ?? null
        break
      case "--top":
        options.top = Number.parseInt(next() ?? "10", 10)
        break
      case "--request-event":
        options.requestEvent = next() ?? null
        break
      default:
        if (arg.startsWith("--")) {
          console.error(`[metrics] unknown option "${arg}"`)
          options.error = true
        }
    }
  }
  return options
}

// ---------------------------------------------------------------------------
// Input sources — line async generators, mirroring scripts/logging/ship.mjs.
// ---------------------------------------------------------------------------

async function* stdinLines() {
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity })
  for await (const line of rl) yield line
}

async function* fileLines(path) {
  const rl = readline.createInterface({
    input: createReadStream(path, { encoding: "utf8" }),
    crlfDelay: Infinity,
  })
  for await (const line of rl) yield line
}

// ---------------------------------------------------------------------------
// Demo fixture — synthetic pino lines spread over ~5 minutes, shaped like the
// summary line from src/lib/request-logging.ts plus a few app log lines.
// ---------------------------------------------------------------------------

// Deterministic PRNG so --demo output is stable for docs and tests.
function mulberry32(seed) {
  let a = seed >>> 0
  return function next() {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function demoLines() {
  const rand = mulberry32(0x5eed)
  const now = Date.now()
  const windowMs = 5 * 60 * 1000
  const lines = []

  const routes = [
    { method: "GET", path: "/api/projects", weight: 40, p50: 18, p95: 60 },
    { method: "GET", path: "/api/projects/:id/documents", weight: 20, p50: 32, p95: 140 },
    { method: "POST", path: "/api/uploads", weight: 15, p50: 90, p95: 420 },
    { method: "GET", path: "/api/search", weight: 15, p50: 55, p95: 240 },
    { method: "DELETE", path: "/api/projects/:id", weight: 10, p50: 24, p95: 80 },
  ]
  const totalWeight = routes.reduce((sum, r) => sum + r.weight, 0)

  // Box–Muller-ish jitter around a per-route median.
  const latency = (route) => {
    const jitter = -Math.log(1 - rand()) // exponential-ish tail
    return Math.max(0.5, route.p50 * (0.4 + jitter * 0.5))
  }

  const pick = () => {
    let roll = rand() * totalWeight
    for (const route of routes) {
      roll -= route.weight
      if (roll <= 0) return route
    }
    return routes[0]
  }

  const push = (record) => lines.push(JSON.stringify(record))

  push({
    level: "info",
    time: new Date(now - windowMs).toISOString(),
    pid: 412,
    hostname: "spindle-app-1",
    service: "spindle",
    msg: "server listening",
    port: 3000,
  })

  const requestCount = 240
  // Error plans are "occurrences per 100 requests" for that route.
  const errorPlan = {
    "/api/search": [
      { status: 500, weight: 12, message: "PrismaClientKnownRequestError: connection timeout" },
      { status: 429, weight: 8, message: "rate limit exceeded" },
    ],
    "/api/uploads": [
      { status: 413, weight: 6, message: "payload too large" },
      { status: 502, weight: 2, message: "upstream storage unavailable" },
    ],
    "/api/projects": [{ status: 503, weight: 3, message: "database unavailable" }],
  }

  for (let i = 0; i < requestCount; i++) {
    const route = pick()
    const at = now - windowMs + rand() * windowMs
    const errors = errorPlan[route.path] ?? []
    const errRoll = rand() * 100
    let errorEntry
    let errAcc = 0
    for (const e of errors) {
      errAcc += e.weight
      if (errRoll < errAcc) {
        errorEntry = e
        break
      }
    }

    const status = errorEntry ? errorEntry.status : 200
    const durationMs = Math.round(latency(route) * 10) / 10
    const record = {
      level: errorEntry && status >= 500 ? "error" : status >= 400 ? "warn" : "info",
      time: new Date(at).toISOString(),
      pid: 412,
      hostname: "spindle-app-1",
      service: "spindle",
      event: "api.request",
      requestId: `req_demo_${String(i).padStart(4, "0")}`,
      method: route.method,
      path: route.path,
      status,
      durationMs,
      userId: rand() < 0.7 ? `user_${Math.floor(rand() * 40)}` : null,
      projectId: rand() < 0.6 ? `proj_${Math.floor(rand() * 12)}` : null,
      msg: "api request",
    }
    if (errorEntry) {
      record.error = {
        type: status >= 500 ? "InternalServerError" : "ClientError",
        message: errorEntry.message,
      }
    }
    push(record)

    // Sprinkle non-request app logs between requests.
    if (i % 37 === 0) {
      push({
        level: "debug",
        time: new Date(at).toISOString(),
        pid: 412,
        hostname: "spindle-app-1",
        service: "spindle",
        event: "db.query",
        durationMs: Math.round(rand() * 30 * 10) / 10,
        msg: "query executed",
      })
    }
    if (i % 53 === 0) {
      push({
        level: "error",
        time: new Date(at).toISOString(),
        pid: 412,
        hostname: "spindle-app-1",
        service: "spindle",
        event: "worker.job",
        job: "thumbnail",
        error: { type: "TimeoutError", message: "thumbnail render timed out" },
        msg: "job failed",
      })
    }
  }

  // A non-JSON line proves the parser tolerates stray output.
  lines.push("not-json noise from a dependency")
  // Out-of-order timestamps exercise window detection.
  lines.splice(
    1,
    0,
    JSON.stringify({
      level: "info",
      time: new Date(now - windowMs - 30_000).toISOString(),
      service: "spindle",
      msg: "earlier startup line",
    }),
  )

  return lines
}

// ---------------------------------------------------------------------------
// Parsing + matching
// ---------------------------------------------------------------------------

function parseRecord(raw) {
  try {
    const value = JSON.parse(raw)
    return value && typeof value === "object" && !Array.isArray(value) ? value : null
  } catch {
    return null
  }
}

function getPath(obj, path) {
  if (typeof path !== "string" || path === "") return undefined
  let current = obj
  for (const part of path.split(".")) {
    if (current === null || typeof current !== "object") return undefined
    current = current[part]
  }
  return current
}

function toNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value)
    return Number.isFinite(n) ? n : null
  }
  return null
}

function valuesEqual(a, b) {
  const an = toNumber(a)
  const bn = toNumber(b)
  if (an !== null && bn !== null) return an === bn
  return String(a) === String(b)
}

/**
 * Evaluates one match clause: { field, op, value }.
 * Ops: eq, ne, gt, gte, lt, lte, in (array), exists (boolean).
 */
function matchClause(record, clause) {
  const actual = getPath(record, clause.field)
  const op = clause.op ?? "eq"
  switch (op) {
    case "exists":
      return (actual !== undefined && actual !== null) === Boolean(clause.value ?? true)
    case "in":
      return Array.isArray(clause.value) && clause.value.some((v) => valuesEqual(actual, v))
    case "ne":
      return !valuesEqual(actual, clause.value)
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      const a = toNumber(actual)
      const b = toNumber(clause.value)
      if (a === null || b === null) return false
      if (op === "gt") return a > b
      if (op === "gte") return a >= b
      if (op === "lt") return a < b
      return a <= b
    }
    case "eq":
    default:
      return valuesEqual(actual, clause.value)
  }
}

function matchesFilter(record, filter) {
  if (!Array.isArray(filter) || filter.length === 0) return true
  return filter.every((clause) =>
    clause && typeof clause === "object" ? matchClause(record, clause) : false,
  )
}

// ---------------------------------------------------------------------------
// Aggregation helpers
// ---------------------------------------------------------------------------

function percentile(sorted, p) {
  if (sorted.length === 0) return null
  if (sorted.length === 1) return sorted[0]
  const rank = (p / 100) * (sorted.length - 1)
  const lo = Math.floor(rank)
  const hi = Math.ceil(rank)
  if (lo === hi) return sorted[lo]
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (rank - lo)
}

function summarizeDurations(values) {
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

function round1(n) {
  return n === null || n === undefined ? n : Math.round(n * 10) / 10
}

function labelKey(labels) {
  return JSON.stringify(labels)
}

function bump(map, key, delta = 1) {
  map.set(key, (map.get(key) ?? 0) + delta)
}

// ---------------------------------------------------------------------------
// Config-driven metrics
// ---------------------------------------------------------------------------

async function loadConfig(path) {
  try {
    const raw = await readFile(path, "utf8")
    const config = JSON.parse(raw)
    return { config, error: null }
  } catch (error) {
    if (error && error.code === "ENOENT") return { config: null, error: null }
    return { config: null, error: error.message }
  }
}

function validateMetric(metric, index) {
  const problems = []
  if (!metric || typeof metric !== "object") return [`metrics[${index}] is not an object`]
  if (typeof metric.name !== "string" || !/^[a-zA-Z_:][a-zA-Z0-9_:]*$/.test(metric.name)) {
    problems.push(`metrics[${index}].name must be a valid metric name`)
  }
  if (!["counter", "gauge", "histogram"].includes(metric.type)) {
    problems.push(`metrics[${index}].type must be counter|gauge|histogram`)
  }
  if (metric.type === "histogram") {
    if (!metric.value) problems.push(`metrics[${index}].value is required for histograms`)
    if (!Array.isArray(metric.buckets) || metric.buckets.length === 0) {
      problems.push(`metrics[${index}].buckets must be a non-empty array`)
    }
  }
  if (metric.groupBy !== undefined && !Array.isArray(metric.groupBy)) {
    problems.push(`metrics[${index}].groupBy must be an array of field names`)
  }
  return problems
}

/**
 * Evaluates config metric definitions against parsed records.
 * Returns an array of { name, description, type, series: Map<labelKey,
 * {labels, count?, sum?, buckets?..., last?}> }.
 */
function evaluateConfigMetrics(records, metrics) {
  const results = []

  for (const metric of metrics) {
    const series = new Map()
    const groups = metric.groupBy ?? []

    const seriesFor = (record) => {
      const labels = {}
      for (const field of groups) {
        const value = getPath(record, field)
        labels[field] = value === undefined || value === null ? "" : String(value)
      }
      const key = labelKey(labels)
      if (!series.has(key)) {
        series.set(key, { labels, count: 0, sum: 0, last: null, buckets: null })
      }
      return series.get(key)
    }

    for (const record of records) {
      if (!matchesFilter(record, metric.match)) continue
      const entry = seriesFor(record)

      if (metric.type === "histogram") {
        const value = toNumber(getPath(record, metric.value))
        if (value === null) continue
        if (!entry.buckets) {
          entry.buckets = metric.buckets.map((b) => ({ le: b, count: 0 }))
          entry.count = 0
          entry.sum = 0
        }
        entry.sum += value
        entry.count += 1
        for (const bucket of entry.buckets) {
          if (value <= bucket.le) bucket.count += 1
        }
      } else if (metric.type === "counter") {
        entry.count += 1
      } else {
        // gauge: value of the last matching record in file order.
        entry.last = getPath(record, metric.value ?? "value")
      }
    }

    results.push({
      name: metric.name,
      description: metric.description ?? "",
      type: metric.type,
      help: metric.help ?? metric.description ?? "",
      series: [...series.values()].filter(
        (s) => s.count > 0 || s.last !== null || (s.buckets && s.buckets.some((b) => b.count > 0)),
      ),
    })
  }

  return results
}

// ---------------------------------------------------------------------------
// Core summary from api.request lines
// ---------------------------------------------------------------------------

function buildSummary(records, requestEvent, topN) {
  const requests = records.filter((r) => r.event === requestEvent)
  const durations = []
  const perEndpoint = new Map()
  const errorsByStatus = new Map()
  const errorsByRoute = new Map()
  const errorMessages = new Map()
  const levelCounts = new Map()

  let first = null
  let last = null

  for (const record of records) {
    const level = typeof record.level === "string" ? record.level : "unknown"
    bump(levelCounts, level)

    const time = Date.parse(record.time)
    if (Number.isFinite(time)) {
      if (first === null || time < first) first = time
      if (last === null || time > last) last = time
    }
  }

  for (const req of requests) {
    const method = String(req.method ?? "UNKNOWN")
    const path = String(req.path ?? "UNKNOWN")
    const status = Number.isFinite(Number(req.status)) ? Number(req.status) : 0
    const duration = toNumber(req.durationMs)
    if (duration !== null) durations.push(duration)

    const endpointKey = labelKey({ method, path, status })
    if (!perEndpoint.has(endpointKey)) {
      perEndpoint.set(endpointKey, {
        method,
        path,
        status,
        count: 0,
        errors: 0,
        durationSum: 0,
        durationCount: 0,
        durations: [],
      })
    }
    const ep = perEndpoint.get(endpointKey)
    ep.count += 1
    if (status >= 400) {
      ep.errors += 1
      bump(errorsByStatus, String(status))
      bump(errorsByRoute, `${method} ${path}`)
      const message = req.error?.message ?? req.msg ?? "(no message)"
      bump(errorMessages, String(message))
    }
    if (duration !== null) {
      ep.durationSum += duration
      ep.durationCount += 1
      ep.durations.push(duration)
    }
  }

  const windowSeconds =
    first !== null && last !== null && last > first ? (last - first) / 1000 : null

  const endpoints = [...perEndpoint.values()]
    .map((ep) => {
      const sorted = [...ep.durations].sort((a, b) => a - b)
      return {
        method: ep.method,
        path: ep.path,
        status: ep.status,
        count: ep.count,
        errors: ep.errors,
        errorRate: ep.count > 0 ? round4(ep.errors / ep.count) : 0,
        avgDurationMs: ep.durationCount > 0 ? round1(ep.durationSum / ep.durationCount) : null,
        p95DurationMs: sorted.length > 0 ? round1(percentile(sorted, 95)) : null,
      }
    })
    .sort((a, b) => b.count - a.count || a.path.localeCompare(b.path))

  const totalRequests = requests.length
  const totalErrors = [...errorsByStatus.values()].reduce((a, b) => a + b, 0)

  return {
    window: {
      first: first !== null ? new Date(first).toISOString() : null,
      last: last !== null ? new Date(last).toISOString() : null,
      seconds: windowSeconds !== null ? round1(windowSeconds) : null,
    },
    lines: {
      read: null, // filled by caller
      valid: records.length,
    },
    requests: {
      total: totalRequests,
      errors: totalErrors,
      errorRate: totalRequests > 0 ? round4(totalErrors / totalRequests) : 0,
      perSecond: windowSeconds ? round2(totalRequests / windowSeconds) : null,
    },
    latencyMs: summarizeDurations(durations),
    errorsByStatus: Object.fromEntries([...errorsByStatus.entries()].sort()),
    errorsByRoute: Object.fromEntries([...errorsByRoute.entries()].sort((a, b) => b[1] - a[1])),
    topErrorMessages: [...errorMessages.entries()]
      .map(([message, count]) => ({ message, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, topN),
    endpoints: endpoints.slice(0, topN),
    endpointCount: endpoints.length,
    levels: Object.fromEntries([...levelCounts.entries()].sort()),
  }
}

function round2(n) {
  return Math.round(n * 100) / 100
}

function round4(n) {
  return Math.round(n * 10000) / 10000
}

// ---------------------------------------------------------------------------
// Renderers
// ---------------------------------------------------------------------------

function escapeLabel(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")
}

function labelsString(labels) {
  const keys = Object.keys(labels).sort()
  if (keys.length === 0) return ""
  return `{${keys.map((k) => `${k}="${escapeLabel(labels[k])}"`).join(",")}}`
}

function renderPrometheus(report) {
  const lines = []
  const emit = (name, help, type, series) => {
    lines.push(`# HELP ${name} ${help}`)
    lines.push(`# TYPE ${name} ${type}`)
    for (const s of series) lines.push(`${name}${labelsString(s.labels)} ${s.value}`)
  }

  const s = report.summary

  // Request counters — one series per method/path/status.
  emit(
    "spindle_requests_total",
    "HTTP requests observed in api.request log lines",
    "counter",
    report.endpointSeries.map((ep) => ({
      labels: ep.labels,
      value: ep.count,
    })),
  )

  const errorSeries = report.endpointSeries
    .filter((ep) => ep.status >= 400)
    .map((ep) => ({ labels: ep.labels, value: ep.errors }))
    .filter((ep) => ep.value > 0)
  emit("spindle_request_errors_total", "HTTP requests with status >= 400", "counter", errorSeries)

  // Request-rate gauge for the observed window.
  emit(
    "spindle_request_rate_per_second",
    "Requests per second over the observed log window",
    "gauge",
    [{ labels: {}, value: s.requests.perSecond ?? 0 }],
  )
  emit("spindle_log_window_seconds", "Seconds covered by the parsed log window", "gauge", [
    { labels: {}, value: s.window.seconds ?? 0 },
  ])

  // Latency histogram per route (method+path), from durationMs.
  if (report.latencyHistogram.length > 0) {
    lines.push(`# HELP spindle_request_duration_ms Request duration in milliseconds`)
    lines.push(`# TYPE spindle_request_duration_ms histogram`)
    for (const h of report.latencyHistogram) {
      const base = { method: h.method, path: h.path }
      for (const bucket of h.buckets) {
        lines.push(
          `spindle_request_duration_ms_bucket${labelsString({ ...base, le: bucket.le })} ${bucket.count}`,
        )
      }
      lines.push(
        `spindle_request_duration_ms_bucket${labelsString({ ...base, le: "+Inf" })} ${h.count}`,
      )
      lines.push(`spindle_request_duration_ms_sum${labelsString(base)} ${h.sum}`)
      lines.push(`spindle_request_duration_ms_count${labelsString(base)} ${h.count}`)
    }
  }

  // Config-driven metrics.
  for (const metric of report.configMetrics) {
    if (metric.type === "histogram") {
      lines.push(`# HELP ${metric.name} ${metric.help}`)
      lines.push(`# TYPE ${metric.name} histogram`)
      for (const series of metric.series) {
        for (const bucket of series.buckets) {
          lines.push(
            `${metric.name}_bucket${labelsString({ ...series.labels, le: bucket.le })} ${bucket.count}`,
          )
        }
        lines.push(
          `${metric.name}_bucket${labelsString({ ...series.labels, le: "+Inf" })} ${series.count}`,
        )
        lines.push(`${metric.name}_sum${labelsString(series.labels)} ${round2(series.sum)}`)
        lines.push(`${metric.name}_count${labelsString(series.labels)} ${series.count}`)
      }
    } else {
      const type = metric.type === "counter" ? "counter" : "gauge"
      emit(
        metric.name,
        metric.help,
        type,
        metric.series.map((series) => ({
          labels: series.labels,
          value: metric.type === "counter" ? series.count : Number(series.last ?? 0),
        })),
      )
    }
  }

  return `${lines.join("\n")}\n`
}

function renderJson(report) {
  return `${JSON.stringify(report, null, 2)}\n`
}

function renderMarkdown(report) {
  const s = report.summary
  const out = []
  out.push(`# Log-based metrics report`)
  out.push("")
  out.push(
    `- Window: ${s.window.first ?? "n/a"} → ${s.window.last ?? "n/a"} (${s.window.seconds ?? "?"}s)`,
  )
  out.push(`- Lines parsed: ${s.lines.valid} valid JSON`)
  out.push(
    `- Requests: **${s.requests.total}** (${s.requests.perSecond ?? "?"}/s), errors: **${s.requests.errors}** (${(s.requests.errorRate * 100).toFixed(2)}%)`,
  )
  out.push("")
  out.push(`## Latency (ms)`)
  out.push("")
  if (s.latencyMs) {
    out.push(`| p50 | p90 | p95 | p99 | avg | min | max |`)
    out.push(`| --- | --- | --- | --- | --- | --- | --- |`)
    out.push(
      `| ${s.latencyMs.p50} | ${s.latencyMs.p90} | ${s.latencyMs.p95} | ${s.latencyMs.p99} | ${s.latencyMs.avg} | ${s.latencyMs.min} | ${s.latencyMs.max} |`,
    )
  } else {
    out.push(`_no duration data_`)
  }
  out.push("")
  out.push(`## Errors by status`)
  out.push("")
  const statuses = Object.entries(s.errorsByStatus)
  if (statuses.length === 0) out.push(`_none_`)
  else {
    out.push(`| status | count |`)
    out.push(`| --- | --- |`)
    for (const [status, count] of statuses) out.push(`| ${status} | ${count} |`)
  }
  out.push("")
  out.push(`## Top error messages`)
  out.push("")
  if (s.topErrorMessages.length === 0) out.push(`_none_`)
  else {
    out.push(`| count | message |`)
    out.push(`| --- | --- |`)
    for (const { message, count } of s.topErrorMessages) {
      out.push(`| ${count} | ${message.replace(/\|/g, "\\|")} |`)
    }
  }
  out.push("")
  out.push(`## Per-endpoint breakdown (top ${s.endpoints.length} of ${s.endpointCount})`)
  out.push("")
  out.push(`| method | path | status | count | errors | error rate | avg ms | p95 ms |`)
  out.push(`| --- | --- | --- | --- | --- | --- | --- | --- |`)
  for (const ep of s.endpoints) {
    out.push(
      `| ${ep.method} | ${ep.path} | ${ep.status} | ${ep.count} | ${ep.errors} | ${(ep.errorRate * 100).toFixed(1)}% | ${ep.avgDurationMs ?? "-"} | ${ep.p95DurationMs ?? "-"} |`,
    )
  }
  out.push("")
  out.push(`## Log levels`)
  out.push("")
  out.push(`| level | count |`)
  out.push(`| --- | --- |`)
  for (const [level, count] of Object.entries(s.levels)) out.push(`| ${level} | ${count} |`)
  out.push("")
  return `${out.join("\n")}\n`
}

function renderText(report) {
  const s = report.summary
  const out = []
  out.push("[metrics] log-based metrics report")
  out.push(
    `[metrics] window ${s.window.first ?? "?"} -> ${s.window.last ?? "?"} (${s.window.seconds ?? "?"}s), ${s.lines.valid} valid lines`,
  )
  out.push(
    `[metrics] requests=${s.requests.total} rate=${s.requests.perSecond ?? "?"}/s errors=${s.requests.errors} errorRate=${(s.requests.errorRate * 100).toFixed(2)}%`,
  )
  if (s.latencyMs) {
    out.push(
      `[metrics] latency_ms p50=${s.latencyMs.p50} p90=${s.latencyMs.p90} p95=${s.latencyMs.p95} p99=${s.latencyMs.p99} avg=${s.latencyMs.avg}`,
    )
  }
  out.push("[metrics] errors by status:")
  for (const [status, count] of Object.entries(s.errorsByStatus)) {
    out.push(`[metrics]   ${status}: ${count}`)
  }
  out.push("[metrics] top error messages:")
  for (const { message, count } of s.topErrorMessages) {
    out.push(`[metrics]   ${count}x ${message}`)
  }
  out.push("[metrics] endpoints (top " + s.endpoints.length + "):")
  for (const ep of s.endpoints) {
    out.push(
      `[metrics]   ${ep.method} ${ep.path} -> ${ep.status} count=${ep.count} errors=${ep.errors} avgMs=${ep.avgDurationMs ?? "-"} p95Ms=${ep.p95DurationMs ?? "-"}`,
    )
  }
  return `${out.join("\n")}\n`
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function collectRecords(source) {
  const records = []
  let read = 0
  let invalid = 0
  for await (const raw of source) {
    read += 1
    const record = parseRecord(raw)
    if (record) records.push(record)
    else invalid += 1
  }
  return { records, read, invalid }
}

const DEFAULT_HISTOGRAM_BUCKETS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000]

function buildLatencyHistogram(requests) {
  const groups = new Map()
  for (const req of requests) {
    const method = String(req.method ?? "UNKNOWN")
    const path = String(req.path ?? "UNKNOWN")
    const duration = toNumber(req.durationMs)
    if (duration === null) continue
    const key = labelKey({ method, path })
    if (!groups.has(key)) {
      groups.set(key, { method, path, durations: [] })
    }
    groups.get(key).durations.push(duration)
  }

  return [...groups.values()].map((g) => {
    const sorted = [...g.durations].sort((a, b) => a - b)
    const buckets = DEFAULT_HISTOGRAM_BUCKETS.map((le) => ({
      le,
      count: sorted.filter((v) => v <= le).length,
    }))
    return {
      method: g.method,
      path: g.path,
      count: sorted.length,
      sum: round2(sorted.reduce((a, b) => a + b, 0)),
      buckets,
    }
  })
}

async function main() {
  const args = parseArgs(process.argv.slice(2))

  if (args.help) {
    console.log(HELP)
    return
  }
  if (args.error) {
    console.error(HELP)
    process.exitCode = 2
    return
  }

  const formats = String(args.format ?? "text")
    .split(",")
    .map((f) => f.trim())
    .filter(Boolean)
  const invalidFormats = formats.filter(
    (f) => !["text", "json", "markdown", "prometheus"].includes(f),
  )
  if (invalidFormats.length > 0) {
    console.error(
      `[metrics] unknown format(s): ${invalidFormats.join(", ")} (text|json|markdown|prometheus)`,
    )
    process.exitCode = 2
    return
  }

  const topN = Number.isFinite(args.top) && args.top > 0 ? args.top : 10

  // Config (optional — a missing file just means no extra metrics).
  const configPath = resolve(repoRoot, String(args.config ?? DEFAULT_CONFIG))
  const { config, error: configError } = await loadConfig(configPath)
  if (configError) {
    console.error(`[metrics] could not parse config ${configPath}: ${configError}`)
    process.exitCode = 2
    return
  }
  if (config && !Array.isArray(config.metrics)) {
    console.error(`[metrics] config ${configPath} must contain a "metrics" array`)
    process.exitCode = 2
    return
  }
  const configProblems = (config?.metrics ?? []).flatMap((m, i) => validateMetric(m, i))
  if (configProblems.length > 0) {
    for (const problem of configProblems) console.error(`[metrics] config: ${problem}`)
    process.exitCode = 2
    return
  }

  const requestEvent = args.requestEvent ?? config?.requestEvent ?? "api.request"

  // Source selection.
  let source
  if (args.demo) {
    source = (async function* () {
      yield* demoLines()
    })()
  } else if (args.file && args.file !== "-") {
    source = fileLines(resolve(repoRoot, args.file))
  } else {
    source = stdinLines()
  }

  const { records, read, invalid } = await collectRecords(source)
  const summary = buildSummary(records, requestEvent, topN)
  summary.lines.read = read

  const configMetrics = evaluateConfigMetrics(records, config?.metrics ?? [])
  const latencyHistogram = buildLatencyHistogram(records.filter((r) => r.event === requestEvent))

  const report = {
    generatedAt: new Date().toISOString(),
    requestEvent,
    summary,
    configMetrics: configMetrics.map((m) => ({
      name: m.name,
      description: m.description,
      help: m.help,
      type: m.type,
      series: m.series,
    })),
    endpointSeries: buildEndpointSeries(records, requestEvent),
    latencyHistogram,
  }

  if (formats.includes("prometheus")) {
    process.stdout.write(renderPrometheus(report))
  }
  if (formats.includes("json")) {
    process.stdout.write(renderJson(report))
  }
  if (formats.includes("markdown")) {
    process.stdout.write(renderMarkdown(report))
  }
  if (formats.includes("text") || formats.length === 0) {
    process.stdout.write(renderText(report))
  }

  if (invalid > 0) {
    console.error(`[metrics] skipped ${invalid} non-JSON line(s)`)
  }
}

/** Per method/path/status series used by the Prometheus renderers. */
function buildEndpointSeries(records, requestEvent) {
  const groups = new Map()
  for (const req of records) {
    if (req.event !== requestEvent) continue
    const method = String(req.method ?? "UNKNOWN")
    const path = String(req.path ?? "UNKNOWN")
    const status = Number.isFinite(Number(req.status)) ? Number(req.status) : 0
    const key = labelKey({ method, path, status })
    if (!groups.has(key)) {
      groups.set(key, { labels: { method, path, status: String(status) }, count: 0, errors: 0 })
    }
    const g = groups.get(key)
    g.count += 1
    if (status >= 400) g.errors += 1
  }
  return [...groups.values()].map((g) => ({
    labels: g.labels,
    status: Number(g.labels.status),
    count: g.count,
    errors: g.errors,
  }))
}

main().catch((error) => {
  console.error(`[metrics] fatal: ${error?.stack ?? error}`)
  process.exitCode = 2
})
