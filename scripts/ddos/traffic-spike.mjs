#!/usr/bin/env node
/**
 * traffic-spike.mjs — per-minute request-rate spike detector for Spindle logs.
 *
 * Reads newline-delimited pino JSON lines (the shape emitted by
 * src/lib/logger.ts + src/lib/request-logging.ts; see
 * docs/observability/log-aggregation.md), keeps only `api.request` summary
 * lines, buckets them per minute, and reports:
 *
 *   - requests per minute and error rate (4xx/5xx) per bucket
 *   - p50/p95 latency per bucket (from `durationMs`)
 *   - top paths per bucket
 *   - a spike verdict per bucket vs the window baseline (median req/min)
 *
 * Companion to scripts/metrics/log-metrics.mjs (Prometheus metrics) and
 * scripts/slo/report.mjs (SLO attainment). This tool answers the narrower
 * question: "did request volume spike, and what did it hit?" — the first
 * signal in docs/security/ddos-protection.md §Layer 3.
 *
 * Usage:
 *   node scripts/ddos/traffic-spike.mjs --demo
 *   node scripts/ddos/traffic-spike.mjs --file logs/app.log --json
 *   docker compose logs app | node scripts/ddos/traffic-spike.mjs --stdin
 *
 * Exit codes: 0 ok (spike or not — detection is informational),
 *             1 at least one bucket flagged as a spike (--strict turns this
 *               into a nonzero exit for alerting pipelines),
 *             2 usage error.
 */

import { createReadStream } from "node:fs"
import { readFile } from "node:fs/promises"
import readline from "node:readline"

const HELP = `traffic-spike.mjs — detect per-minute request-rate spikes in pino logs

Sources (pick one):
  --stdin              read lines from stdin (default when no source is given)
  --file <path>        read a file once ('-' reads stdin)
  --demo               feed built-in synthetic pino lines and exit

Output:
  --format <list>      comma-separated: text,json (default: text)
  --strict             exit 1 when any bucket is flagged as a spike
  --spike-factor <n>   flag a bucket when req/min > factor * median
                       (default: 3)
  --min-requests <n>   ignore buckets below this count (default: 10)
  --request-event <e>  event name treated as an HTTP request summary
                       (default: api.request)
  --help, -h           show this message

Exit codes: 0 ok, 1 spike found (--strict), 2 usage error.`

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const options = {
    help: false,
    demo: false,
    stdin: false,
    file: null,
    formats: ["text"],
    strict: false,
    spikeFactor: 3,
    minRequests: 10,
    requestEvent: "api.request",
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const next = () => {
      const v = argv[++i]
      if (v === undefined) {
        console.error(`missing value for ${arg}`)
        process.exit(2)
      }
      return v
    }
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
        options.file = next()
        break
      case "--format":
        options.formats = next()
          .split(",")
          .map((f) => f.trim())
          .filter(Boolean)
        break
      case "--strict":
        options.strict = true
        break
      case "--spike-factor":
        options.spikeFactor = Number(next())
        break
      case "--min-requests":
        options.minRequests = Number(next())
        break
      case "--request-event":
        options.requestEvent = next()
        break
      default:
        console.error(`unknown argument: ${arg}`)
        process.exit(2)
    }
  }
  if (!Number.isFinite(options.spikeFactor) || options.spikeFactor <= 0) {
    console.error("--spike-factor must be a positive number")
    process.exit(2)
  }
  if (!Number.isFinite(options.minRequests) || options.minRequests < 0) {
    console.error("--min-requests must be a non-negative number")
    process.exit(2)
  }
  for (const f of options.formats) {
    if (f !== "text" && f !== "json") {
      console.error(`unsupported format: ${f} (text|json)`)
      process.exit(2)
    }
  }
  return options
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

async function* lineSource(options) {
  if (options.demo) {
    yield* demoLines()
    return
  }
  const file = options.file
  if (!file || file === "-") {
    if (options.stdin || !file) {
      const rl = readline.createInterface({ input: process.stdin })
      for await (const line of rl) yield line
      return
    }
  }
  const rl = readline.createInterface({
    input: createReadStream(file, { encoding: "utf8" }),
    crlfDelay: Infinity,
  })
  for await (const line of rl) yield line
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

const bucketKey = (iso) => {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  d.setUTCSeconds(0, 0)
  return d.toISOString()
}

const percentile = (sorted, p) => {
  if (sorted.length === 0) return null
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
  return sorted[Math.max(0, idx)]
}

const median = (values) => {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

async function collect(options) {
  const buckets = new Map() // minuteISO -> { count, errors, serverErrors, durations[], paths:Map }
  let parsed = 0
  let requests = 0
  let skipped = 0

  for await (const line of lineSource(options)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    let record
    try {
      record = JSON.parse(trimmed)
    } catch {
      skipped++
      continue
    }
    parsed++
    if (record?.event !== options.requestEvent) continue
    const key = bucketKey(record.time)
    if (!key) {
      skipped++
      continue
    }
    let b = buckets.get(key)
    if (!b) {
      b = { count: 0, errors: 0, serverErrors: 0, durations: [], paths: new Map() }
      buckets.set(key, b)
    }
    requests++
    b.count++
    const status = Number(record.status) || 0
    if (status >= 400) b.errors++
    if (status >= 500) b.serverErrors++
    const dur = Number(record.durationMs)
    if (Number.isFinite(dur)) b.durations.push(dur)
    const path = typeof record.path === "string" ? record.path : "(unknown)"
    b.paths.set(path, (b.paths.get(path) ?? 0) + 1)
  }

  const rows = [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([minute, b]) => {
      const durations = [...b.durations].sort((x, y) => x - y)
      const topPaths = [...b.paths.entries()]
        .sort((a, c) => c[1] - a[1])
        .slice(0, 3)
        .map(([p, n]) => `${p}(${n})`)
        .join(", ")
      return {
        minute,
        requests: b.count,
        errorRate: b.count ? b.errors / b.count : 0,
        serverErrorRate: b.count ? b.serverErrors / b.count : 0,
        p50Ms: percentile(durations, 50),
        p95Ms: percentile(durations, 95),
        topPaths,
      }
    })

  const counts = rows.map((r) => r.requests)
  const baseline = median(counts)
  const flagged = rows.map((r) => {
    const spike =
      r.requests >= options.minRequests &&
      baseline > 0 &&
      r.requests > baseline * options.spikeFactor
    return { ...r, baseline, spike }
  })

  return { parsed, requests, skipped, rows: flagged }
}

// ---------------------------------------------------------------------------
// Demo data — deterministic, includes a 10x spike in the middle of the window
// ---------------------------------------------------------------------------

function demoLines() {
  const rand = mulberry32(0x5eed)
  const now = Date.now()
  const windowMin = 30
  const lines = []

  const routes = [
    { method: "GET", path: "/api/projects", weight: 40, p50: 18 },
    { method: "GET", path: "/api/projects/:id/documents", weight: 20, p50: 32 },
    { method: "POST", path: "/api/uploads", weight: 15, p50: 90 },
    { method: "GET", path: "/api/search", weight: 15, p50: 55 },
    { method: "DELETE", path: "/api/projects/:id", weight: 10, p50: 24 },
  ]
  const totalWeight = routes.reduce((s, r) => s + r.weight, 0)
  const pick = () => {
    let roll = rand() * totalWeight
    for (const r of routes) {
      roll -= r.weight
      if (roll <= 0) return r
    }
    return routes[0]
  }

  for (let min = windowMin; min >= 0; min--) {
    const at = now - min * 60_000
    // Baseline ~2 req/s = ~120/min; spike window is minutes 12–15 at ~10x,
    // concentrated on / and /api/search with mostly 429/404s.
    const inSpike = min >= 12 && min <= 15
    const perMinute = inSpike ? 1200 : 120
    for (let i = 0; i < perMinute; i++) {
      const route = inSpike
        ? rand() < 0.7
          ? { method: "GET", path: "/", weight: 1, p50: 5 }
          : { method: "GET", path: "/api/search", weight: 1, p50: 400 }
        : pick()
      const ts = new Date(at + rand() * 60_000)
      const status = inSpike
        ? rand() < 0.6
          ? 429
          : rand() < 0.5
            ? 404
            : 200
        : rand() < 0.02
          ? 500
          : 200
      lines.push(
        JSON.stringify({
          level: status >= 500 ? "error" : status >= 400 ? "warn" : "info",
          time: ts.toISOString(),
          service: "spindle",
          event: "api.request",
          requestId: `req_demo_${min}_${i}`,
          method: route.method,
          path: route.path,
          status,
          durationMs: Math.round(route.p50 * (0.4 - Math.log(1 - rand()) * 0.5) * 10) / 10,
          msg: "api request",
        }),
      )
    }
  }
  return lines
}

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

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

function fmtMs(v) {
  return v === null ? "-" : `${v.toFixed(1)}ms`
}

function renderText(result, options) {
  const out = []
  out.push(
    `traffic-spike: ${result.requests} api.request lines across ${result.rows.length} minute buckets ` +
      `(parsed ${result.parsed}, skipped ${result.skipped})`,
  )
  const baseline = result.rows[0]?.baseline ?? 0
  out.push(
    `baseline (median req/min): ${baseline.toFixed(1)}  spike factor: ${options.spikeFactor}x`,
  )
  out.push("")
  out.push(
    `${"minute (UTC)".padEnd(18)} ${"req/min".padStart(8)} ${"err%".padStart(6)} ${"5xx%".padStart(6)} ${"p50".padStart(9)} ${"p95".padStart(9)}  spike?  top paths`,
  )
  for (const r of result.rows) {
    out.push(
      [
        r.minute.slice(0, 16).padEnd(18),
        String(r.requests).padStart(8),
        `${(r.errorRate * 100).toFixed(1)}%`.padStart(6),
        `${(r.serverErrorRate * 100).toFixed(1)}%`.padStart(6),
        fmtMs(r.p50Ms).padStart(9),
        fmtMs(r.p95Ms).padStart(9),
        (r.spike ? "SPIKE" : "").padEnd(7),
        r.topPaths,
      ].join(" "),
    )
  }
  const spikes = result.rows.filter((r) => r.spike)
  out.push("")
  if (spikes.length === 0) {
    out.push("no spikes detected — request volume within baseline.")
  } else {
    out.push(
      `SPIKE DETECTED in ${spikes.length} bucket(s): ${spikes
        .map(
          (s) =>
            `${s.minute.slice(11, 16)} UTC (${s.requests} req/min, ${(s.errorRate * 100).toFixed(0)}% errors)`,
        )
        .join("; ")}`,
    )
    out.push(
      "Next steps: docs/security/ddos-protection.md §Layer 3 — edge controls first (IUAM, rate-limit rule), then confirm origin ingress is closed.",
    )
  }
  return out.join("\n")
}

function renderJson(result, options) {
  return JSON.stringify(
    {
      tool: "scripts/ddos/traffic-spike.mjs",
      spikeFactor: options.spikeFactor,
      minRequests: options.minRequests,
      parsedLines: result.parsed,
      apiRequests: result.requests,
      skippedLines: result.skipped,
      buckets: result.rows.length,
      spikes: result.rows.filter((r) => r.spike).length,
      baselineRequestsPerMinute: result.rows[0]?.baseline ?? 0,
      rows: result.rows,
    },
    null,
    2,
  )
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    console.log(HELP)
    return 0
  }
  const result = await collect(options)
  for (const format of options.formats) {
    if (format === "text") console.log(renderText(result, options))
    if (format === "json") console.log(renderJson(result, options))
  }
  const hasSpike = result.rows.some((r) => r.spike)
  return options.strict && hasSpike ? 1 : 0
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err)
    process.exit(2)
  })
