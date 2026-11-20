#!/usr/bin/env node
/**
 * API usage analytics for Spindle's `api.request` log lines.
 *
 * Reads newline-delimited JSON log lines (the shape emitted by
 * src/lib/request-logging.ts — one summary line per request with
 * event/method/path/status/durationMs/userId/projectId), aggregates them,
 * and renders a usage report as text, JSON, or markdown.
 *
 * Always computed (per-endpoint, unless noted):
 *
 *   - request counts and error rates per endpoint (method + path)
 *   - latency percentiles (p50/p90/p95/p99) from `durationMs`
 *   - status distribution (2xx/3xx/4xx/5xx buckets and raw codes)
 *   - top consumers by `userId` and `projectId` (count, errors, share)
 *   - top error messages (`error.message`, falling back to `msg`)
 *
 * This is the usage/consumer view; for Prometheus exposition and
 * config-driven metrics use scripts/metrics/log-metrics.mjs instead —
 * docs/analytics/api-usage.md explains how the two fit together.
 *
 * Usage:
 *   node scripts/analytics/api/usage.mjs --demo
 *   node scripts/analytics/api/usage.mjs --file logs/app.log --format json
 *   node scripts/analytics/api/usage.mjs --stdin --format markdown
 *   node scripts/analytics/api/usage.mjs --demo --format text,json,markdown
 *
 * Exit codes: 0 ok, 2 usage error.
 */

import { createReadStream } from "node:fs"
import { dirname, resolve } from "node:path"
import readline from "node:readline"
import { fileURLToPath } from "node:url"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, "../../..")

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const HELP = `usage.mjs — API usage analytics from api.request log lines

Sources (pick one):
  --stdin              read lines from stdin (default when no source is given)
  --file <path>        read a file once ('-' reads stdin)
  --demo               feed built-in synthetic pino lines and exit

Output:
  --format <list>      comma-separated: text,json,markdown
                       (default: text)
  --request-event <e>  event name treated as an HTTP request summary
                       (default: api.request)
  --top <n>            rows in top-N tables (default: 10)
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
      case "--request-event":
        options.requestEvent = next() ?? null
        break
      case "--top":
        options.top = Number.parseInt(next() ?? "10", 10)
        break
      default:
        if (arg.startsWith("--")) {
          console.error(`[usage] unknown option "${arg}"`)
          options.error = true
        }
    }
  }
  return options
}

// ---------------------------------------------------------------------------
// Input sources
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
// Demo fixture — deterministic synthetic pino lines shaped like
// src/lib/request-logging.ts output, with skewed user/project usage so the
// top-consumer tables are meaningful.
// ---------------------------------------------------------------------------

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
  const rand = mulberry32(0x5157)
  const now = Date.now()
  const windowMs = 10 * 60 * 1000
  const lines = []

  const push = (record) => lines.push(JSON.stringify(record))

  // Weight = relative traffic; p50 drives latency; errors = % of requests
  // that fail with the given status/message.
  const routes = [
    {
      method: "GET",
      path: "/api/projects",
      weight: 30,
      p50: 20,
      errors: [
        { status: 500, pct: 1, message: "PrismaClientKnownRequestError: connection timeout" },
      ],
    },
    {
      method: "GET",
      path: "/api/projects/:id/documents",
      weight: 20,
      p50: 40,
      errors: [{ status: 404, pct: 4, message: "document not found" }],
    },
    {
      method: "POST",
      path: "/api/uploads",
      weight: 12,
      p50: 110,
      errors: [
        { status: 413, pct: 5, message: "payload too large" },
        { status: 502, pct: 1, message: "upstream storage unavailable" },
      ],
    },
    {
      method: "GET",
      path: "/api/search",
      weight: 18,
      p50: 60,
      errors: [
        { status: 500, pct: 3, message: "search backend timeout" },
        { status: 429, pct: 4, message: "rate limit exceeded" },
      ],
    },
    {
      method: "GET",
      path: "/api/notifications",
      weight: 10,
      p50: 15,
      errors: [],
    },
    {
      method: "DELETE",
      path: "/api/projects/:id",
      weight: 6,
      p50: 30,
      errors: [{ status: 403, pct: 6, message: "insufficient project role" }],
    },
    {
      method: "POST",
      path: "/api/feedback",
      weight: 4,
      p50: 25,
      errors: [],
    },
  ]
  const totalWeight = routes.reduce((sum, r) => sum + r.weight, 0)

  const pick = () => {
    let roll = rand() * totalWeight
    for (const route of routes) {
      roll -= route.weight
      if (roll <= 0) return route
    }
    return routes[0]
  }

  const latency = (route) => {
    const jitter = -Math.log(1 - rand())
    return Math.max(0.5, route.p50 * (0.4 + jitter * 0.6))
  }

  // Skewed consumers: a few heavy users/projects, a long tail, and some
  // anonymous (null) requests.
  const heavyUsers = ["user_ana", "user_ben", "user_cid"]
  const tailUsers = Array.from({ length: 25 }, (_, i) => `user_t${i}`)
  const heavyProjects = ["proj_alpha", "proj_beta"]
  const tailProjects = Array.from({ length: 10 }, (_, i) => `proj_t${i}`)

  const pickUser = () => {
    const roll = rand()
    if (roll < 0.15) return null
    if (roll < 0.45) return heavyUsers[Math.floor(rand() * heavyUsers.length)]
    if (roll < 0.8) return tailUsers[Math.floor(rand() * tailUsers.length)]
    return null
  }
  const pickProject = () => {
    const roll = rand()
    if (roll < 0.2) return null
    if (roll < 0.55) return heavyProjects[Math.floor(rand() * heavyProjects.length)]
    return tailProjects[Math.floor(rand() * tailProjects.length)]
  }

  push({
    level: "info",
    time: new Date(now - windowMs).toISOString(),
    pid: 512,
    hostname: "spindle-app-2",
    service: "spindle",
    msg: "server listening",
    port: 3000,
  })

  const requestCount = 600
  for (let i = 0; i < requestCount; i++) {
    const route = pick()
    const at = now - windowMs + rand() * windowMs

    let errorEntry = null
    let errAcc = 0
    const errRoll = rand() * 100
    for (const e of route.errors) {
      errAcc += e.pct
      if (errRoll < errAcc) {
        errorEntry = e
        break
      }
    }

    const status = errorEntry ? errorEntry.status : 200
    const record = {
      level: errorEntry && status >= 500 ? "error" : status >= 400 ? "warn" : "info",
      time: new Date(at).toISOString(),
      pid: 512,
      hostname: "spindle-app-2",
      service: "spindle",
      event: "api.request",
      requestId: `req_demo_${String(i).padStart(4, "0")}`,
      method: route.method,
      path: route.path,
      status,
      durationMs: Math.round(latency(route) * 10) / 10,
      userId: pickUser(),
      projectId: pickProject(),
      msg: "api request",
    }
    if (errorEntry) {
      record.error = {
        type: status >= 500 ? "InternalServerError" : "ClientError",
        message: errorEntry.message,
      }
    }
    push(record)

    // Non-request noise: proves the aggregator ignores other events.
    if (i % 41 === 0) {
      push({
        level: "debug",
        time: new Date(at).toISOString(),
        pid: 512,
        hostname: "spindle-app-2",
        service: "spindle",
        event: "db.query",
        durationMs: Math.round(rand() * 25 * 10) / 10,
        msg: "query executed",
      })
    }
    if (i % 67 === 0) {
      push({
        level: "error",
        time: new Date(at).toISOString(),
        pid: 512,
        hostname: "spindle-app-2",
        service: "spindle",
        event: "worker.job",
        job: "thumbnail",
        error: { type: "TimeoutError", message: "thumbnail render timed out" },
        msg: "job failed",
      })
    }
  }

  lines.push("not-json noise from a dependency")

  return lines
}

// ---------------------------------------------------------------------------
// Parsing + aggregation (mirrors src/lib/api-analytics/usage.ts — kept
// dependency-free so the script runs without a TS toolchain).
// ---------------------------------------------------------------------------

function parseRecord(raw) {
  try {
    const value = JSON.parse(raw)
    return value && typeof value === "object" && !Array.isArray(value) ? value : null
  } catch {
    return null
  }
}

function toNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value)
    return Number.isFinite(n) ? n : null
  }
  return null
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0
  if (sorted.length === 1) return sorted[0]
  const rank = (p / 100) * (sorted.length - 1)
  const lo = Math.floor(rank)
  const hi = Math.ceil(rank)
  if (lo === hi) return sorted[lo]
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (rank - lo)
}

function round1(n) {
  return Math.round(n * 10) / 10
}

function round2(n) {
  return Math.round(n * 100) / 100
}

function round4(n) {
  return Math.round(n * 10000) / 10000
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

function errorMessage(record) {
  const error = record.error
  if (
    error &&
    typeof error === "object" &&
    typeof error.message === "string" &&
    error.message !== ""
  ) {
    return error.message
  }
  if (typeof record.msg === "string" && record.msg !== "") return record.msg
  return "(no message)"
}

function consumerId(value) {
  return typeof value === "string" && value !== "" ? value : null
}

function aggregate(records, requestEvent, topN) {
  const requests = records.filter((r) => r.event === requestEvent)
  const durations = []
  const statusDistribution = new Map()
  const endpoints = new Map()
  const users = new Map()
  const projects = new Map()
  const errorMessages = new Map()

  let first = null
  let last = null
  let errors = 0
  let serverErrors = 0
  let clientErrors = 0

  const bumpConsumer = (map, id, failed) => {
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
    const failed = status >= 400

    if (failed) {
      errors += 1
      if (status >= 500) serverErrors += 1
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
      if (status >= 500) ep.serverErrors += 1
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

  const endpointList = [...endpoints.values()]
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

  const toConsumers = (map) =>
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
    generatedAt: new Date().toISOString(),
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

// ---------------------------------------------------------------------------
// Renderers
// ---------------------------------------------------------------------------

function fmtPct(rate) {
  return `${(rate * 100).toFixed(1)}%`
}

function fmtLatency(latency) {
  if (!latency) return "-"
  return `avg=${latency.avg} p50=${latency.p50} p95=${latency.p95} p99=${latency.p99}`
}

function renderJson(report) {
  return `${JSON.stringify(report, null, 2)}\n`
}

function renderMarkdown(report) {
  const out = []
  out.push(`# API usage report`)
  out.push("")
  out.push(`- Event: \`${report.requestEvent}\``)
  out.push(
    `- Window: ${report.window.first ?? "n/a"} → ${report.window.last ?? "n/a"} (${report.window.seconds ?? "?"}s)`,
  )
  out.push(`- Requests: **${report.totals.requests}** (${report.totals.perSecond ?? "?"}/s)`)
  out.push(
    `- Errors: **${report.totals.errors}** (${fmtPct(report.totals.errorRate)}) — 5xx: ${report.totals.serverErrors}, 4xx: ${report.totals.clientErrors}`,
  )
  out.push("")
  out.push(`## Latency (ms)`)
  out.push("")
  if (report.latencyMs) {
    const l = report.latencyMs
    out.push(`| count | min | avg | p50 | p90 | p95 | p99 | max |`)
    out.push(`| --- | --- | --- | --- | --- | --- | --- | --- |`)
    out.push(
      `| ${l.count} | ${l.min} | ${l.avg} | ${l.p50} | ${l.p90} | ${l.p95} | ${l.p99} | ${l.max} |`,
    )
  } else {
    out.push(`_no duration data_`)
  }
  out.push("")
  out.push(`## Status distribution`)
  out.push("")
  const statuses = Object.entries(report.statusDistribution)
  if (statuses.length === 0) out.push(`_none_`)
  else {
    out.push(`| status | count |`)
    out.push(`| --- | --- |`)
    for (const [status, count] of statuses) out.push(`| ${status} | ${count} |`)
  }
  out.push("")
  out.push(`## Endpoints (top ${report.endpoints.length} of ${report.endpointCount})`)
  out.push("")
  out.push(`| method | path | count | errors | error rate | 5xx | 4xx | avg ms | p95 ms | p99 ms |`)
  out.push(`| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |`)
  for (const ep of report.endpoints) {
    out.push(
      `| ${ep.method} | ${ep.path} | ${ep.count} | ${ep.errors} | ${fmtPct(ep.errorRate)} | ${ep.serverErrors} | ${ep.clientErrors} | ${ep.latency?.avg ?? "-"} | ${ep.latency?.p95 ?? "-"} | ${ep.latency?.p99 ?? "-"} |`,
    )
  }
  out.push("")
  out.push(`## Top users`)
  out.push("")
  if (report.topUsers.length === 0) out.push(`_none (all requests anonymous)_`)
  else {
    out.push(`| userId | count | share | errors | error rate |`)
    out.push(`| --- | --- | --- | --- | --- |`)
    for (const u of report.topUsers) {
      out.push(
        `| ${u.id} | ${u.count} | ${fmtPct(u.share)} | ${u.errors} | ${fmtPct(u.errorRate)} |`,
      )
    }
  }
  out.push("")
  out.push(`## Top projects`)
  out.push("")
  if (report.topProjects.length === 0) out.push(`_none_`)
  else {
    out.push(`| projectId | count | share | errors | error rate |`)
    out.push(`| --- | --- | --- | --- | --- |`)
    for (const p of report.topProjects) {
      out.push(
        `| ${p.id} | ${p.count} | ${fmtPct(p.share)} | ${p.errors} | ${fmtPct(p.errorRate)} |`,
      )
    }
  }
  out.push("")
  out.push(`## Top error messages`)
  out.push("")
  if (report.topErrorMessages.length === 0) out.push(`_none_`)
  else {
    out.push(`| count | message |`)
    out.push(`| --- | --- |`)
    for (const { message, count } of report.topErrorMessages) {
      out.push(`| ${count} | ${message.replace(/\|/g, "\\|")} |`)
    }
  }
  out.push("")
  return `${out.join("\n")}\n`
}

function renderText(report) {
  const out = []
  out.push("[usage] api usage report")
  out.push(
    `[usage] event=${report.requestEvent} window ${report.window.first ?? "?"} -> ${report.window.last ?? "?"} (${report.window.seconds ?? "?"}s)`,
  )
  out.push(
    `[usage] requests=${report.totals.requests} rate=${report.totals.perSecond ?? "?"}/s errors=${report.totals.errors} errorRate=${fmtPct(report.totals.errorRate)} 5xx=${report.totals.serverErrors} 4xx=${report.totals.clientErrors}`,
  )
  if (report.latencyMs) {
    const l = report.latencyMs
    out.push(
      `[usage] latency_ms count=${l.count} min=${l.min} avg=${l.avg} p50=${l.p50} p90=${l.p90} p95=${l.p95} p99=${l.p99} max=${l.max}`,
    )
  }
  out.push("[usage] status distribution:")
  for (const [status, count] of Object.entries(report.statusDistribution)) {
    out.push(`[usage]   ${status}: ${count}`)
  }
  out.push(
    "[usage] endpoints (top " + report.endpoints.length + " of " + report.endpointCount + "):",
  )
  for (const ep of report.endpoints) {
    out.push(
      `[usage]   ${ep.method} ${ep.path} count=${ep.count} errors=${ep.errors} errRate=${fmtPct(ep.errorRate)} 5xx=${ep.serverErrors} 4xx=${ep.clientErrors} ${fmtLatency(ep.latency)}`,
    )
  }
  out.push("[usage] top users:")
  for (const u of report.topUsers) {
    out.push(`[usage]   ${u.id} count=${u.count} share=${fmtPct(u.share)} errors=${u.errors}`)
  }
  out.push("[usage] top projects:")
  for (const p of report.topProjects) {
    out.push(`[usage]   ${p.id} count=${p.count} share=${fmtPct(p.share)} errors=${p.errors}`)
  }
  out.push("[usage] top error messages:")
  for (const { message, count } of report.topErrorMessages) {
    out.push(`[usage]   ${count}x ${message}`)
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
  const invalidFormats = formats.filter((f) => !["text", "json", "markdown"].includes(f))
  if (invalidFormats.length > 0) {
    console.error(`[usage] unknown format(s): ${invalidFormats.join(", ")} (text|json|markdown)`)
    process.exitCode = 2
    return
  }

  const topN = Number.isFinite(args.top) && args.top > 0 ? args.top : 10

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

  const requestEvent = args.requestEvent ?? "api.request"
  const { records, read, invalid } = await collectRecords(source)
  const report = aggregate(records, requestEvent, topN)
  report.lines.read = read

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
    console.error(`[usage] skipped ${invalid} non-JSON line(s)`)
  }
  if (report.totals.requests === 0) {
    console.error(`[usage] warning: no ${requestEvent} records found in input`)
  }
}

main().catch((error) => {
  console.error(`[usage] fatal: ${error?.stack ?? error}`)
  process.exitCode = 2
})
