#!/usr/bin/env node
/**
 * API analytics report over `api.request` JSONL logs.
 *
 * Deeper than scripts/metrics/log-metrics.mjs (which answers "what is the
 * rate right now"): this tool answers longitudinal questions — per-endpoint
 * request volume over time, error-budget burn, top users/projects, new vs
 * returning endpoints, and latency/error anomaly detection.
 *
 * The analytics core lives in src/lib/api-analytics/core.ts (pure functions,
 * unit-tested with vitest); this script loads it through tsx so the CLI stays
 * dependency-free at runtime beyond the repo's own devDependencies.
 *
 * Usage:
 *   node scripts/analytics/api/analyze.mjs --demo
 *   node scripts/analytics/api/analyze.mjs --file logs/app.log --format markdown
 *   cat logs/app.log | node scripts/analytics/api/analyze.mjs --stdin --json
 *   node scripts/analytics/api/analyze.mjs --demo --format text,json,markdown
 *
 * Options:
 *   --demo                  feed built-in synthetic api.request lines
 *   --file <path>           read a JSONL file once ('-' reads stdin)
 *   --stdin                 read lines from stdin (default with no source)
 *   --format <list>         comma-separated: text,json,markdown (default text)
 *   --json                  shorthand for --format json
 *   --markdown              shorthand for --format markdown
 *   --bucket-hours <n>      time-series bucket width in hours (default 24)
 *   --new-window-days <n>   trailing window marking endpoints "new" (default 7)
 *   --error-budget <pct>    allowed error % for budget burn (default 1)
 *   --top <n>               rows in top-user/top-project tables (default 10)
 *   --help, -h              show this message
 *
 * Exit codes: 0 ok, 2 usage error.
 */

import { createReadStream } from "node:fs"
import readline from "node:readline"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, "../../..")
const CORE_PATH = resolve(repoRoot, "src/lib/api-analytics/core.ts")

const HELP = `analyze.mjs — API analytics over api.request JSONL logs

Sources (pick one):
  --demo               synthetic 14-day fixture (default source if none given)
  --file <path>        read a file once ('-' reads stdin)
  --stdin              read lines from stdin

Output:
  --format <list>      comma-separated: text,json,markdown (default: text)
  --json               shorthand for --format json
  --markdown           shorthand for --format markdown
  --bucket-hours <n>   time-series bucket width in hours (default: 24)
  --new-window-days <n> trailing window marking endpoints "new" (default: 7)
  --error-budget <pct> allowed error percent for budget burn (default: 1)
  --top <n>            rows in actor tables (default: 10)
  --help, -h           show this message

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
        options.format = (next() ?? "text")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
        break
      case "--json":
        options.format = ["json"]
        break
      case "--markdown":
        options.format = ["markdown"]
        break
      case "--bucket-hours":
        options.bucketHours = Number.parseFloat(next() ?? "24")
        break
      case "--new-window-days":
        options.newWindowDays = Number.parseFloat(next() ?? "7")
        break
      case "--error-budget":
        options.errorBudgetPct = Number.parseFloat(next() ?? "1")
        break
      case "--top":
        options.top = Number.parseInt(next() ?? "10", 10)
        break
      default:
        if (arg.startsWith("--")) {
          console.error(`[api-analytics] unknown option "${arg}"`)
          options.error = true
        }
    }
  }
  if (!options.format) options.format = ["text"]
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

async function* demoLines() {
  for (const line of demoRecords()) yield JSON.stringify(line)
}

// ---------------------------------------------------------------------------
// Demo fixture — 14 days of synthetic api.request lines with a latency
// regression on /api/search and an error spike on /api/uploads in the last
// 3 days, so every report section has something to show.
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

function demoRecords() {
  const rand = mulberry32(0xa91)
  const DAY = 24 * 60 * 60 * 1000
  const now = Date.now()
  const spanDays = 14
  const lines = []

  const users = Array.from({ length: 12 }, (_, i) => `user_${i + 1}`)
  const projects = Array.from({ length: 5 }, (_, i) => `proj_${i + 1}`)

  const routes = [
    { method: "GET", path: "/api/projects", weight: 35, p50: 20, errors: [] },
    { method: "GET", path: "/api/projects/:id/documents", weight: 20, p50: 45, errors: [] },
    { method: "GET", path: "/api/search", weight: 15, p50: 60, errors: [] },
    { method: "POST", path: "/api/uploads", weight: 10, p50: 120, errors: [] },
    { method: "DELETE", path: "/api/projects/:id", weight: 5, p50: 30, errors: [] },
    // Endpoint that only appears in the last 4 days → "new".
    { method: "GET", path: "/api/insights", weight: 15, p50: 80, errors: [], sinceDaysAgo: 4 },
  ]
  const totalWeight = routes.reduce((s, r) => s + r.weight, 0)

  // ~90 requests/day spread over 14 days.
  const requestsPerDay = 90
  let seq = 0

  for (let day = spanDays - 1; day >= 0; day--) {
    const dayStart = now - day * DAY
    const isRecent = day <= 2 // last ~3 days
    for (let i = 0; i < requestsPerDay; i++) {
      const at = dayStart - rand() * DAY
      let roll = rand() * totalWeight
      let route = routes[0]
      for (const r of routes) {
        roll -= r.weight
        if (roll <= 0) {
          route = r
          break
        }
      }
      if (route.sinceDaysAgo !== undefined && day > route.sinceDaysAgo) continue

      // Latency regression: /api/search p50 triples in the last ~3 days.
      let p50 = route.p50
      if (route.path === "/api/search" && isRecent) p50 *= 3
      // /api/uploads gets a ~30% 500-rate across the whole recent half of the
      // window (vs ~0.5% baseline) so the error-spike detector fires.
      let status = 200
      let error
      if (route.path === "/api/uploads") {
        const errRate = day <= 6 ? 0.3 : 0.005
        if (rand() < errRate) {
          status = 500
          error = { type: "InternalServerError", message: "storage backend timeout" }
        }
      } else if (rand() < 0.004) {
        status = rand() < 0.5 ? 429 : 404
        error = {
          type: "ClientError",
          message: status === 429 ? "rate limit exceeded" : "not found",
        }
      }

      const durationMs =
        Math.round(Math.max(0.5, p50 * (0.4 - Math.log(1 - rand()) * 0.5)) * 10) / 10
      lines.push({
        level: status >= 500 ? "error" : status >= 400 ? "warn" : "info",
        time: new Date(at).toISOString(),
        pid: 412,
        hostname: "spindle-app-1",
        service: "spindle",
        event: "api.request",
        requestId: `req_demo_${String(seq++).padStart(5, "0")}`,
        method: route.method,
        path: route.path,
        status,
        durationMs,
        userId: rand() < 0.75 ? users[Math.floor(rand() * users.length)] : null,
        projectId: rand() < 0.65 ? projects[Math.floor(rand() * projects.length)] : null,
        ...(error ? { error } : {}),
        msg: "api request",
      })
    }
  }

  lines.push("not-json noise from a dependency")
  return lines
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function fmtMs(value) {
  return value === null || value === undefined ? "—" : `${value}ms`
}

function fmtPct(value) {
  return `${(value * 100).toFixed(2)}%`
}

function fmtNum(value, digits = 0) {
  return value === null || value === undefined ? "—" : Number(value).toFixed(digits)
}

function pad(str, width) {
  const s = String(str)
  return s.length >= width ? s : s + " ".repeat(width - s.length)
}

function table(headers, rows) {
  const widths = headers.map((h, i) =>
    Math.max(String(h).length, ...rows.map((r) => String(r[i] ?? "").length)),
  )
  const line = (cells) =>
    cells
      .map((c, i) => pad(c, widths[i]))
      .join("  ")
      .trimEnd()
  return [line(headers), line(widths.map((w) => "-".repeat(w))), ...rows.map(line)].join("\n")
}

function renderText(report, top) {
  const out = []
  const w = report.window
  out.push("API analytics — api.request summary")
  out.push(`Window: ${w.first ?? "—"} → ${w.last ?? "—"} (${fmtNum(w.seconds)}s)`)
  out.push(
    `Requests: ${w.requests}  Errors: ${w.errors} (${fmtPct(w.errorRate)})  ` +
      `Users: ${w.uniqueUsers}  Projects: ${w.uniqueProjects}`,
  )
  out.push("")

  out.push("Endpoints (sorted by volume)")
  const epRows = report.endpoints
    .slice(0, top)
    .map((e) => [
      `${e.method} ${e.path}`,
      e.requests,
      e.errors,
      fmtPct(e.errorRate),
      e.errorBudget.burnRate > 1 ? `🔥${e.errorBudget.burnRate}×` : `${e.errorBudget.burnRate}×`,
      fmtMs(e.p95DurationMs),
      e.isNew ? "new" : "",
    ])
  out.push(table(["Endpoint", "Reqs", "Errs", "ErrRate", "Budget", "p95", "Flag"], epRows))
  out.push("")

  if (report.anomalies.length > 0) {
    out.push("Anomalies")
    const rows = report.anomalies.map((a) => [
      a.severity.toUpperCase(),
      a.type,
      a.endpoint,
      a.detail,
    ])
    out.push(table(["Sev", "Type", "Endpoint", "Detail"], rows))
    out.push("")
  } else {
    out.push("Anomalies: none detected")
    out.push("")
  }

  out.push(`Top users (of ${report.topUsers.length} tracked)`)
  out.push(
    table(
      ["User", "Reqs", "Errs", "ErrRate", "p95", "Projects"],
      report.topUsers
        .slice(0, top)
        .map((u) => [
          u.id,
          u.requests,
          u.errors,
          fmtPct(u.errorRate),
          fmtMs(u.p95DurationMs),
          u.relatedCount,
        ]),
    ),
  )
  out.push("")

  out.push(`Top projects (of ${report.topProjects.length} tracked)`)
  out.push(
    table(
      ["Project", "Reqs", "Errs", "ErrRate", "p95", "Users"],
      report.topProjects
        .slice(0, top)
        .map((p) => [
          p.id,
          p.requests,
          p.errors,
          fmtPct(p.errorRate),
          fmtMs(p.p95DurationMs),
          p.relatedCount,
        ]),
    ),
  )
  out.push("")

  // Compact per-endpoint daily sparkline-ish series: requests per bucket.
  out.push("Requests per bucket (per endpoint)")
  const byEndpoint = new Map()
  for (const p of report.timeSeries) {
    if (!byEndpoint.has(p.endpoint)) byEndpoint.set(p.endpoint, new Map())
    byEndpoint.get(p.endpoint).set(p.bucketStart, p.requests)
  }
  const bucketStarts = [...new Set(report.timeSeries.map((p) => p.bucketStart))].sort()
  const tsRows = [...byEndpoint.entries()]
    .sort((a, b) => {
      const sum = (m) => [...m.values()].reduce((x, y) => x + y, 0)
      return sum(b[1]) - sum(a[1])
    })
    .slice(0, top)
    .map(([endpoint, buckets]) => [endpoint, ...bucketStarts.map((b) => buckets.get(b) ?? 0)])
  out.push(table(["Endpoint", ...bucketStarts.map((b) => b.slice(0, 10))], tsRows))
  out.push("")

  if (report.newEndpoints.length > 0) {
    out.push(
      `New endpoints (first seen in last ${report.options.newEndpointWindowMs / 86400000}d):`,
    )
    for (const e of report.newEndpoints) out.push(`  - ${e}`)
    out.push("")
  }

  return out.join("\n")
}

function renderMarkdown(report, top) {
  const out = []
  const w = report.window
  out.push("# API analytics")
  out.push("")
  out.push(`- **Window:** ${w.first ?? "—"} → ${w.last ?? "—"} (${fmtNum(w.seconds)}s)`)
  out.push(
    `- **Requests:** ${w.requests} · **Errors:** ${w.errors} (${fmtPct(w.errorRate)}) · ` +
      `**Users:** ${w.uniqueUsers} · **Projects:** ${w.uniqueProjects}`,
  )
  out.push("")

  out.push("## Endpoints")
  out.push("")
  out.push("| Endpoint | Requests | Errors | Error rate | Budget burn | p95 | Flags |")
  out.push("| --- | ---: | ---: | ---: | ---: | ---: | --- |")
  for (const e of report.endpoints.slice(0, top)) {
    const flags = [e.isNew ? "new" : ""].filter(Boolean).join(", ") || "—"
    out.push(
      `| \`${e.method} ${e.path}\` | ${e.requests} | ${e.errors} | ${fmtPct(e.errorRate)} | ` +
        `${e.errorBudget.burnRate}× | ${fmtMs(e.p95DurationMs)} | ${flags} |`,
    )
  }
  out.push("")

  out.push("## Anomalies")
  out.push("")
  if (report.anomalies.length === 0) {
    out.push("_None detected._")
  } else {
    out.push("| Severity | Type | Endpoint | Detail |")
    out.push("| --- | --- | --- | --- |")
    for (const a of report.anomalies) {
      out.push(`| ${a.severity} | ${a.type} | \`${a.endpoint}\` | ${a.detail} |`)
    }
  }
  out.push("")

  out.push("## Top users")
  out.push("")
  out.push("| User | Requests | Errors | Error rate | p95 | Projects |")
  out.push("| --- | ---: | ---: | ---: | ---: | ---: |")
  for (const u of report.topUsers.slice(0, top)) {
    out.push(
      `| \`${u.id}\` | ${u.requests} | ${u.errors} | ${fmtPct(u.errorRate)} | ${fmtMs(u.p95DurationMs)} | ${u.relatedCount} |`,
    )
  }
  out.push("")

  out.push("## Top projects")
  out.push("")
  out.push("| Project | Requests | Errors | Error rate | p95 | Users |")
  out.push("| --- | ---: | ---: | ---: | ---: | ---: |")
  for (const p of report.topProjects.slice(0, top)) {
    out.push(
      `| \`${p.id}\` | ${p.requests} | ${p.errors} | ${fmtPct(p.errorRate)} | ${fmtMs(p.p95DurationMs)} | ${p.relatedCount} |`,
    )
  }
  out.push("")

  if (report.newEndpoints.length > 0) {
    out.push("## New endpoints")
    out.push("")
    for (const e of report.newEndpoints) out.push(`- \`${e}\``)
    out.push("")
  }

  return out.join("\n")
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function loadCore() {
  try {
    const { tsImport } = await import("tsx/esm/api")
    return await tsImport(CORE_PATH, import.meta.url)
  } catch (error) {
    console.error(
      `[api-analytics] could not load analytics core via tsx: ${error.message}\n` +
        "Run from the repo root with devDependencies installed (tsx is required).",
    )
    process.exit(2)
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    console.log(HELP)
    return
  }
  if (options.error) {
    console.error(HELP)
    process.exit(2)
  }

  const core = await loadCore()

  const records = []
  let linesRead = 0
  let validLines = 0

  // --demo is the default source when neither --file nor --stdin is given.
  const source =
    options.demo || (!options.file && !options.stdin)
      ? demoLines()
      : options.file && options.file !== "-"
        ? fileLines(options.file)
        : stdinLines()

  for await (const line of source) {
    linesRead++
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const parsed = JSON.parse(trimmed)
      if (parsed && typeof parsed === "object") {
        records.push(parsed)
        validLines++
      }
    } catch {
      // tolerate non-JSON noise
    }
  }

  const analyticsOptions = {
    bucketMs: (options.bucketHours ?? 24) * 60 * 60 * 1000,
    newEndpointWindowMs: (options.newWindowDays ?? 7) * 24 * 60 * 60 * 1000,
    errorBudgetRate: (options.errorBudgetPct ?? 1) / 100,
  }

  const report = core.analyzeApiRequests(records, analyticsOptions)
  // Honor --top for actor tables by truncating rendered output only.
  const top = Number.isFinite(options.top) && options.top > 0 ? options.top : 10

  for (const format of options.format) {
    if (format === "json") {
      console.log(JSON.stringify(report, null, 2))
    } else if (format === "markdown") {
      console.log(renderMarkdown(report, top))
    } else if (format === "text") {
      console.log(renderText(report, top))
      console.error(`[api-analytics] read ${linesRead} lines (${validLines} valid JSON)`)
    } else {
      console.error(`[api-analytics] unknown format "${format}" (text|json|markdown)`)
      process.exit(2)
    }
  }
}

main().catch((error) => {
  console.error(`[api-analytics] fatal: ${error?.stack ?? error}`)
  process.exit(1)
})
