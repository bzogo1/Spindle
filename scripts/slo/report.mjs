#!/usr/bin/env node
// SLI attainment / error-budget reporter for Spindle.
//
//   node scripts/slo/report.mjs --demo
//   node scripts/slo/report.mjs --input reports/load-2025-01-01.json --window day,28d
//   node scripts/slo/report.mjs --input samples.jsonl --service web-app --json
//
// Ingests metric samples and computes per-service SLI attainment against the
// SLO targets defined in docs/slo/service-level-objectives.md, plus remaining
// error budget, over sliding windows (day = last 24h, 28d = last 28 days).
//
// Accepted inputs (repeatable --input):
//   - JSONL, one sample per line:
//       {"ts": 1735689600000, "service": "web-app", "ok": true, "ms": 123}
//     `ts` may be epoch ms or an ISO-8601 string; `ok` may be a boolean or a
//     numeric status (2xx/3xx = ok); `ms` is optional latency in milliseconds.
//     Unknown fields are ignored; `service` defaults to --service/"unknown".
//   - A load.mjs --out report ({version:1, elapsedMs, samples:[...]}). Its
//     samples carry no timestamps, so they are spread evenly across
//     `elapsedMs` ending at the file's mtime (or --now).
//
// --demo generates a deterministic 28-day synthetic dataset (mulberry32, no
// network, no files) and runs it through the same pipeline.
//
// Exit codes: 0 report generated (warnings allowed), 1 at least one SLO
// breached its target in a reported window, 2 usage/IO error.

import { readFileSync, statSync } from "node:fs"
import { basename } from "node:path"

// ---------------------------------------------------------------------------
// SLO catalog — keep in sync with docs/slo/service-level-objectives.md
// ---------------------------------------------------------------------------

const SLOS = [
  {
    id: "web-app",
    title: "Web app (Next.js pages + marketing)",
    availability: { target: 0.999, windowDays: 28 },
    latency: { p95Ms: 800, p99Ms: 2000, sliThresholdMs: 800 },
  },
  {
    id: "api",
    title: "API routes (/api/*)",
    availability: { target: 0.9995, windowDays: 28 },
    latency: { p95Ms: 400, p99Ms: 1000, sliThresholdMs: 400 },
  },
  {
    id: "postgres",
    title: "PostgreSQL dependency (health checks)",
    availability: { target: 0.999, windowDays: 28 },
    latency: null,
  },
]

// Windows offered on the CLI. `day` is a rolling 24h; `7d`/`28d` rolling days.
const WINDOWS = {
  day: 1,
  "7d": 7,
  "28d": 28,
  all: null, // entire sample span
}

const DAY_MS = 24 * 60 * 60 * 1000

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const USAGE = `Usage: node scripts/slo/report.mjs [options]

Options:
  --demo                  generate deterministic synthetic samples (offline)
  --input <file>          ingest samples; repeatable. Accepts JSONL or a
                          load.mjs --out JSON report
  --service <name>        service name for samples that don't carry one
                          (default: "unknown")
  --window <list>         comma-separated windows: day,7d,28d,all
                          (default: day,28d)
  --now <iso|epoch>       evaluation instant for windowing (default: latest
                          sample timestamp, else current time)
  --json                  print only the JSON report
  --help, -h              show this message

Exit codes: 0 report ok (warnings allowed), 1 SLO breach in a window,
2 usage/IO error.`

function parseArgs(argv) {
  const options = {
    demo: false,
    inputs: [],
    service: "unknown",
    windows: ["day", "28d"],
    now: null,
    json: false,
    help: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const next = () => {
      const v = argv[++i]
      if (v === undefined) throw new Error(`${arg} requires a value`)
      return v
    }
    switch (arg) {
      case "--demo":
        options.demo = true
        break
      case "--input":
        options.inputs.push(next())
        break
      case "--service":
        options.service = next()
        break
      case "--window":
        options.windows = next()
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
        break
      case "--now":
        options.now = next()
        break
      case "--json":
        options.json = true
        break
      case "--help":
      case "-h":
        options.help = true
        break
      default:
        throw new Error(`unknown option: ${arg}`)
    }
  }
  for (const w of options.windows) {
    if (!(w in WINDOWS)) {
      throw new Error(`unknown window "${w}" (expected day,7d,28d,all)`)
    }
  }
  if (!options.help && !options.demo && options.inputs.length === 0) {
    throw new Error("nothing to do: pass --demo or at least one --input <file>")
  }
  return options
}

// ---------------------------------------------------------------------------
// Sample normalization
// ---------------------------------------------------------------------------

function parseTs(value) {
  if (value == null) return null
  if (typeof value === "number" && Number.isFinite(value)) {
    // Heuristic: seconds vs milliseconds.
    return value < 1e12 ? value * 1000 : value
  }
  if (typeof value === "string") {
    const n = Number(value)
    if (Number.isFinite(n) && value.trim() !== "") {
      return parseTs(n)
    }
    const t = Date.parse(value)
    return Number.isNaN(t) ? null : t
  }
  return null
}

function toOk(v, status) {
  if (typeof v === "boolean") return v
  if (typeof status === "number") {
    if (status >= 200 && status < 400) return true
    if (status >= 400) return false
  }
  if (typeof v === "number") return v >= 200 && v < 400
  if (typeof v === "string") {
    const n = Number(v)
    if (Number.isFinite(n)) return n >= 200 && n < 400
    return ["ok", "success", "true", "pass", "passed"].includes(v.toLowerCase())
  }
  return null
}

function toMs(rec) {
  for (const k of ["ms", "latencyMs", "durationMs", "elapsedMs", "ttfbMs"]) {
    const v = rec[k]
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) return v
  }
  return null
}

// Normalize one raw record into { ts, service, ok, ms, path? } or null.
function normalizeRecord(rec, defaultService) {
  if (!rec || typeof rec !== "object") return null
  const ts = parseTs(rec.ts ?? rec.timestamp ?? rec.time ?? rec.at)
  const ok = toOk(rec.ok ?? rec.success ?? rec.status, rec.status)
  const ms = toMs(rec)
  if (ts == null || ok == null) return null
  const rawPath = rec.path ?? rec.ep ?? rec.url ?? rec.route ?? null
  // load.mjs labels endpoints "GET /path" — strip the method token.
  const path =
    typeof rawPath === "string" && rawPath.includes(" ")
      ? rawPath.trim().split(/\s+/).pop()
      : rawPath
  let service = rec.service ?? rec.serviceName ?? rec.sli ?? defaultService ?? "unknown"
  service = String(service)
  // Infer a service from the request path when nothing named one: API routes
  // go to `api`, page-like paths to `web-app`. Explicit --service wins.
  if ((service === "unknown" || service == null) && typeof path === "string") {
    if (path.startsWith("/api")) service = "api"
    else if (path === "/" || !path.startsWith("/")) service = "web-app"
    else service = "web-app"
  }
  return { ts, service, ok, ms, path }
}

// Ingest one input file. Returns an array of normalized samples.
function ingestFile(file, defaultService) {
  const raw = readFileSync(file, "utf8")
  const trimmed = raw.trim()
  if (trimmed === "") return []

  // Whole-file JSON: a load.mjs --out report or an array of samples. If the
  // parse fails, fall through to JSONL (first line may start with '{').
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    let doc
    try {
      doc = JSON.parse(trimmed)
    } catch {
      doc = null
    }
    if (doc != null) {
      const arr = Array.isArray(doc) ? doc : doc.samples
      if (Array.isArray(arr)) {
        // load.mjs samples lack timestamps: spread them evenly over
        // elapsedMs ending at the file mtime so windowing still works.
        const hasTs = arr.some((s) => s && (s.ts ?? s.timestamp ?? s.time))
        let end = Date.now()
        try {
          end = statSync(file).mtimeMs
        } catch {
          /* keep Date.now() */
        }
        const span = typeof doc.elapsedMs === "number" ? doc.elapsedMs : 0
        const step = arr.length > 1 && span > 0 ? span / (arr.length - 1) : 0
        const svc = doc.scenario?.service ?? defaultService
        return arr
          .map((s, i) => {
            const ts = hasTs ? null : end - span + i * step
            return normalizeRecord(
              { ...s, ts: s.ts ?? s.timestamp ?? ts, service: svc },
              defaultService,
            )
          })
          .filter(Boolean)
      }
      // Parsed JSON without a samples array — could be a single-line JSONL
      // sample; fall through to per-line parsing.
    }
  }

  // JSONL: one sample per line. Blank lines and non-JSON lines are skipped so
  // plain health-check logs can be concatenated with sample files.
  const out = []
  for (const [i, line] of raw.split("\n").entries()) {
    const t = line.trim()
    if (!t) continue
    let rec
    try {
      rec = JSON.parse(t)
    } catch {
      continue // tolerate non-JSON log lines
    }
    const s = normalizeRecord(rec, defaultService)
    if (!s) {
      throw new Error(`${basename(file)}:${i + 1}: sample missing usable ts/ok fields`)
    }
    out.push(s)
  }
  return out
}

// ---------------------------------------------------------------------------
// Demo data — deterministic, offline, ~28 days of traffic
// ---------------------------------------------------------------------------

function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Log-normal-ish latency sampler.
function makeLatency(rand, medianMs, sigma = 0.6) {
  // Box-Muller on uniform draws.
  const u1 = Math.max(rand(), 1e-9)
  const u2 = rand()
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
  return Math.max(1, Math.round(medianMs * Math.exp(sigma * z)))
}

function genDemoSamples(now) {
  const rand = mulberry32(0x5eed)
  const samples = []
  const DAY = DAY_MS
  const SERVICES = [
    { id: "web-app", weight: 6, medianMs: 180, errP: 0.0006 },
    { id: "api", weight: 3, medianMs: 90, errP: 0.0004 },
    { id: "postgres", weight: 1, medianMs: 4, errP: 0.0002 },
  ]
  // One degraded day for `api` ~9 days ago: elevated latency + errors so the
  // 28d budget is visibly consumed and the SLO target is breached (demo exits 1).
  const incidentStart = now - 9 * DAY
  const incidentEnd = incidentStart + 6 * 60 * 60 * 1000

  const total = 28 * 40 // ~40 samples/day/service-ish; scaled below
  for (let i = 0; i < total * 3; i++) {
    const ts = now - 28 * DAY + rand() * 28 * DAY
    // Pick service by weight.
    let r = rand() * 10
    let svc = SERVICES[0]
    for (const s of SERVICES) {
      if (r < s.weight) {
        svc = s
        break
      }
      r -= s.weight
    }
    const inIncident = svc.id === "api" && ts >= incidentStart && ts < incidentEnd
    const errP = inIncident ? 0.02 : svc.errP
    const ok = rand() >= errP
    let ms
    if (svc.id === "postgres") {
      ms = Math.round(1 + rand() * 8)
    } else if (inIncident) {
      ms = makeLatency(rand, 1200, 0.9)
    } else {
      ms = makeLatency(rand, svc.medianMs)
    }
    samples.push({
      ts: Math.round(ts),
      service: svc.id,
      ok,
      ms,
      path: svc.id === "postgres" ? "pg_isready" : `/${svc.id}`,
    })
  }
  return samples
}

// ---------------------------------------------------------------------------
// SLI computation
// ---------------------------------------------------------------------------

function percentile(sorted, p) {
  if (sorted.length === 0) return null
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
  return sorted[Math.max(0, idx)]
}

function fmtPct(x) {
  if (x == null) return "n/a"
  return `${(x * 100).toFixed(3)}%`
}

function fmtMs(x) {
  if (x == null) return "n/a"
  return x >= 1000 ? `${(x / 1000).toFixed(2)}s` : `${Math.round(x)}ms`
}

function evaluateService(slo, samples) {
  const total = samples.length
  if (total === 0) {
    return { status: "no-data", attainment: null, budgetRemaining: null }
  }
  const goodAvail = samples.filter((s) => s.ok).length
  const attainment = goodAvail / total
  const target = slo.availability.target
  const budget = 1 - target
  // Fraction of the error budget already consumed: observed bad-event rate
  // (1 - attainment) over the budgeted bad-event rate (1 - target). At
  // attainment == target the budget is fully consumed; above target it is
  // negative (surplus).
  const consumed = budget > 0 ? (1 - attainment) / budget : 0
  // Remaining budget as a percent of the total budget, clamped to [0,100]:
  // surplus (attainment far above target) shows as 100% left, not >100%.
  const budgetRemaining = Math.min(1, Math.max(0, 1 - consumed))

  let status = "ok"
  if (attainment < target) status = "breach"
  else if (1 - consumed < 0.2) status = "warning" // <20% of budget left

  const lat = samples
    .map((s) => s.ms)
    .filter((v) => v != null)
    .sort((a, b) => a - b)
  const result = {
    status,
    samples: total,
    good: goodAvail,
    attainment,
    target,
    errorBudget: budget,
    budgetConsumedPct: consumed * 100,
    budgetRemainingPct: budgetRemaining * 100,
    observed: {
      p50Ms: percentile(lat, 50),
      p95Ms: percentile(lat, 95),
      p99Ms: percentile(lat, 99),
      maxMs: lat.length ? lat[lat.length - 1] : null,
    },
  }

  if (slo.latency && lat.length > 0) {
    const thr = slo.latency.sliThresholdMs
    const under = lat.filter((v) => v <= thr).length
    const latAttainment = under / lat.length
    const latTarget = 0.95 // "95% of requests under the p95 budget"
    result.latencySli = {
      thresholdMs: thr,
      attainment: latAttainment,
      target: latTarget,
      status: latAttainment >= latTarget ? "ok" : "breach",
      p95BudgetMs: slo.latency.p95Ms,
      p99BudgetMs: slo.latency.p99Ms,
    }
    if (result.latencySli.status === "breach" && status === "ok") {
      result.status = "warning"
    }
    if (result.observed.p95Ms != null && result.observed.p95Ms > slo.latency.p95Ms) {
      result.latencyNote = `observed p95 ${fmtMs(result.observed.p95Ms)} exceeds budget ${fmtMs(slo.latency.p95Ms)}`
      if (status === "ok") result.status = "warning"
    }
    if (result.observed.p99Ms != null && result.observed.p99Ms > slo.latency.p99Ms) {
      result.latencyNote =
        (result.latencyNote ? result.latencyNote + "; " : "") +
        `observed p99 ${fmtMs(result.observed.p99Ms)} exceeds budget ${fmtMs(slo.latency.p99Ms)}`
    }
  }
  return result
}

function buildReport(samples, options) {
  const now = options.now ?? (samples.length ? Math.max(...samples.map((s) => s.ts)) : Date.now())
  const byService = new Map()
  for (const s of samples) {
    if (!byService.has(s.service)) byService.set(s.service, [])
    byService.get(s.service).push(s)
  }

  const windowsOut = []
  for (const wname of options.windows) {
    const days = WINDOWS[wname]
    const start = days == null ? -Infinity : now - days * DAY_MS
    const windowSamples = samples.filter((s) => s.ts >= start && s.ts <= now)
    const services = {}
    for (const slo of SLOS) {
      services[slo.id] = evaluateService(
        slo,
        windowSamples.filter((s) => s.service === slo.id),
      )
    }
    // Surface unknown services too so nothing is silently dropped.
    for (const [svc, list] of byService) {
      if (!services[svc]) {
        const good = list.filter((s) => s.ts >= start && s.ts <= now && s.ok).length
        const n = list.filter((s) => s.ts >= start && s.ts <= now).length
        services[svc] = {
          status: n === 0 ? "no-data" : "untracked",
          samples: n,
          good,
          attainment: n ? good / n : null,
          note: "no SLO defined for this service",
        }
      }
    }
    windowsOut.push({
      window: wname,
      days,
      start: days == null ? null : new Date(now - days * DAY_MS).toISOString(),
      end: new Date(now).toISOString(),
      samples: windowSamples.length,
      services,
    })
  }

  const breaches = windowsOut.some((w) =>
    Object.values(w.services).some((s) => s.status === "breach"),
  )
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    evaluationInstant: new Date(now).toISOString(),
    slos: SLOS.map((s) => ({
      id: s.id,
      title: s.title,
      availabilityTarget: s.availability.target,
      errorBudgetPct: Math.round((1 - s.availability.target) * 100000) / 1000,
      latency: s.latency,
    })),
    windows: windowsOut,
    exitHint: breaches ? 1 : 0,
  }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function markdownReport(report) {
  const lines = []
  lines.push("# SLO attainment report")
  lines.push("")
  lines.push(`- evaluation instant: ${report.evaluationInstant}`)
  lines.push(`- generated: ${report.generatedAt}`)
  lines.push("")
  lines.push("| service | SLO target | error budget |")
  lines.push("| ------- | ---------- | ------------ |")
  for (const s of report.slos) {
    const lat = s.latency
      ? ` · p95 ≤ ${fmtMs(s.latency.p95Ms)}, p99 ≤ ${fmtMs(s.latency.p99Ms)}`
      : ""
    lines.push(
      `| ${s.id} (${s.title}) | ${(s.availabilityTarget * 100).toFixed(2)}%${lat} | ${s.errorBudgetPct.toFixed(3)}% |`,
    )
  }
  for (const w of report.windows) {
    lines.push("")
    lines.push(`## Window: ${w.window}${w.days ? ` (last ${w.days}d)` : " (all data)"}`)
    lines.push("")
    lines.push(`- span: ${w.start ?? "beginning"} → ${w.end}`)
    lines.push(`- samples: ${w.samples}`)
    lines.push("")
    lines.push(
      "| service | status | samples | good | SLI attainment | budget left | p50 | p95 | p99 |",
    )
    lines.push(
      "| ------- | ------ | ------- | ---- | -------------- | ----------- | --- | --- | --- |",
    )
    for (const [id, s] of Object.entries(w.services)) {
      const p = s.observed ?? {}
      lines.push(
        `| ${id} | ${s.status} | ${s.samples ?? "-"} | ${s.good ?? "-"} | ${fmtPct(s.attainment)} | ${s.budgetRemainingPct == null ? "n/a" : `${s.budgetRemainingPct.toFixed(1)}%`} | ${fmtMs(p.p50Ms)} | ${fmtMs(p.p95Ms)} | ${fmtMs(p.p99Ms)} |`,
      )
      if (s.latencyNote) lines.push(`| | | | | | | | _${s.latencyNote}_ |`)
      if (s.note) lines.push(`| | | | | | | _${s.note}_ |`)
    }
  }
  lines.push("")
  lines.push(
    "Status: `ok` = within target with ≥20% budget remaining · `warning` = budget <20% or latency budget exceeded · `breach` = SLI below target · `no-data`/`untracked` = insufficient samples or no SLO defined.",
  )
  lines.push("")
  return lines.join("\n")
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

function main() {
  let options
  try {
    options = parseArgs(process.argv.slice(2))
  } catch (err) {
    console.error(`[slo] ${err.message}`)
    console.error(USAGE)
    process.exit(2)
  }
  if (options.help) {
    console.log(USAGE)
    return
  }

  let now = null
  if (options.now != null) {
    now = parseTs(options.now)
    if (now == null) {
      console.error(`[slo] invalid --now value: ${options.now}`)
      process.exit(2)
    }
  }

  let samples
  if (options.demo) {
    samples = genDemoSamples(now ?? Date.now())
    if (!options.json) {
      console.error(`[slo] demo mode: ${samples.length} synthetic samples`)
    }
  } else {
    samples = []
    for (const file of options.inputs) {
      try {
        samples.push(...ingestFile(file, options.service))
      } catch (err) {
        console.error(`[slo] ${err.message}`)
        process.exit(2)
      }
    }
  }

  if (samples.length === 0) {
    console.error("[slo] no usable samples found")
    process.exit(2)
  }

  const report = buildReport(samples, { ...options, now })
  if (options.json) {
    console.log(JSON.stringify(report, null, 2))
  } else {
    process.stdout.write(markdownReport(report))
  }
  process.exit(report.exitHint)
}

main()
