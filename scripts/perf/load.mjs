#!/usr/bin/env node
// Dependency-free HTTP load generator.
//
//   node scripts/perf/load.mjs --demo [--duration 5s] [--concurrency 10]
//   node scripts/perf/load.mjs --config scripts/perf/scenarios/homepage.json
//   node scripts/perf/load.mjs --target https://staging.example.com \
//       --endpoints /,/api/health --duration 60s --concurrency 25 --rps 200
//
// A scenario JSON file looks like:
//   {
//     "name": "homepage",
//     "target": "https://example.com",
//     "concurrency": 20,          // virtual users (default 10)
//     "rps": 100,                 // target request rate across all users (0 = unthrottled)
//     "duration": "60s",          // run length: number = seconds, or "500ms"/"2m"/"1h"
//     "rampSec": 10,              // optional: linearly ramp concurrency over N seconds
//     "warmupMs": 2000,           // optional: discard samples recorded during warmup
//     "timeoutMs": 10000,         // per-request timeout (default 10000)
//     "headers": { "user-agent": "spindle-load/1.0" },
//     "endpoints": [
//       { "path": "/", "method": "GET", "weight": 5 },
//       { "path": "/api/auth/session", "expect": [200, 401] },
//       { "path": "/api/contact", "method": "POST", "body": { "email": "load@example.com" } }
//     ]
//   }
//
// `expect` is a list of acceptable HTTP status codes (default [200]); anything
// else counts as an error. Network failures and timeouts always count.
//
// Reports: a markdown summary on stdout plus an optional JSON report
// (--out) containing every sample for offline analysis.

import { createServer } from "node:http"
import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { dirname } from "node:path"

// ---------------------------------------------------------------------------
// args / config
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { _: [] }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (!arg.startsWith("--")) {
      args._.push(arg)
      continue
    }
    const eq = arg.indexOf("=")
    if (eq !== -1) {
      args[arg.slice(2, eq)] = arg.slice(eq + 1)
    } else if (["demo", "help"].includes(arg.slice(2))) {
      args[arg.slice(2)] = true
    } else {
      args[arg.slice(2)] = argv[++i]
    }
  }
  return args
}

const USAGE = `Usage:
  node scripts/perf/load.mjs --demo [options]
  node scripts/perf/load.mjs --config <scenario.json> [options]
  node scripts/perf/load.mjs --target <url> --endpoints <paths> [options]

Options:
  --config <file>       JSON scenario file (see header comment for schema)
  --demo                Spin up a local demo target server and run a demo scenario
  --target <url>        Base URL override (applies to --config and ad-hoc runs)
  --endpoints <list>    Comma-separated paths for ad-hoc runs (weights equal)
  --concurrency <n>     Virtual users (default: 10, or config value)
  --rps <n>             Target requests/second across all users (default: 0 = max)
  --duration <spec>     Run length: seconds, or 500ms / 2m / 1h (default: 30s)
  --ramp <sec>          Ramp concurrency linearly over N seconds (default: 0)
  --warmup <ms>         Warmup window whose samples are discarded (default: 0)
  --timeout <ms>        Per-request timeout (default: 10000)
  --out <file.json>     Write full JSON report (samples + summary)
  --name <name>         Scenario name for the report (default: ad-hoc/demo)
  --help                Show this help
`

function parseDuration(spec) {
  if (spec == null) return 30_000
  const s = String(spec).trim()
  const m = s.match(/^([\d.]+)\s*(ms|s|m|h)?$/i)
  if (!m) throw new Error(`invalid duration "${spec}" (use e.g. 30s, 500ms, 2m)`)
  const n = Number(m[1])
  const unit = (m[2] ?? "s").toLowerCase()
  const mult = { ms: 1, s: 1000, m: 60_000, h: 3_600_000 }[unit]
  return Math.round(n * mult)
}

function loadConfig(path, overrides) {
  const raw = JSON.parse(readFileSync(path, "utf8"))
  return finalizeConfig(
    loadConfigRaw({
      ...raw,
      ...pickOverrides(overrides),
      name: overrides.name ?? raw.name ?? path,
    }),
  )
}

function adHocConfig(args) {
  if (!args.target || !args.endpoints) {
    throw new Error("ad-hoc mode requires --target <url> and --endpoints <path,path,...>")
  }
  const cfg = loadConfigRaw({
    name: args.name ?? "ad-hoc",
    target: args.target,
    concurrency: args.concurrency,
    rps: args.rps,
    duration: args.duration,
    rampSec: args.ramp,
    warmupMs: args.warmup,
    timeoutMs: args.timeout,
    endpoints: String(args.endpoints)
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean)
      .map((path) => ({ path })),
  })
  return finalizeConfig(cfg)
}

// CLI overrides win over file values; undefined entries are dropped.
function pickOverrides(o) {
  const out = {}
  for (const k of [
    "target",
    "concurrency",
    "rps",
    "duration",
    "ramp",
    "warmup",
    "timeout",
    "name",
  ]) {
    if (o[k] != null) out[k] = o[k]
  }
  return out
}

function finalizeConfig(cfg) {
  if (!cfg.target) throw new Error(`scenario "${cfg.name}" has no target; pass --target <url>`)
  if (cfg.endpoints.length === 0) throw new Error(`scenario "${cfg.name}" has no endpoints`)
  cfg.target = cfg.target.replace(/\/+$/, "")
  return cfg
}

// One normalizer for JSON files and ad-hoc args (both arrive as strings).
function loadConfigRaw(raw) {
  const rampSec = raw.rampSec ?? (raw.ramp != null ? Number(raw.ramp) : undefined)
  return {
    name: raw.name ?? "unnamed",
    target: raw.target,
    concurrency: Number(raw.concurrency ?? 10),
    rps: Number(raw.rps ?? 0),
    durationMs: parseDuration(raw.duration),
    rampMs: Math.round(Number(rampSec ?? 0) * 1000),
    warmupMs: Number(raw.warmupMs ?? raw.warmup ?? 0),
    timeoutMs: Number(raw.timeoutMs ?? raw.timeout ?? 10_000),
    headers: { ...(raw.headers ?? {}) },
    endpoints: (raw.endpoints ?? []).map((ep, i) => ({
      key: `${ep.method ?? "GET"} ${ep.path ?? "/"}`,
      path: ep.path,
      method: (ep.method ?? "GET").toUpperCase(),
      weight: Number(ep.weight ?? 1),
      headers: ep.headers ?? {},
      body: ep.body,
      expect: Array.isArray(ep.expect) ? ep.expect.map(Number) : [200],
      order: i,
    })),
  }
}

// ---------------------------------------------------------------------------
// demo target server
// ---------------------------------------------------------------------------

const DEMO_HTML = `<!doctype html><html><head><title>spindle perf demo</title></head>
<body><h1>Spindle</h1><p>Load-test demo target.</p></body></html>`

const DEMO_JS = `// demo bundle ${"x".repeat(4096)}\nconsole.log("demo")\n`

function startDemoServer() {
  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://localhost")
    const path = url.pathname
    // Simulated handler latency: 2–25 ms depending on route.
    const delay =
      path === "/slow" ? 150 : path.startsWith("/api/") ? 8 : path.startsWith("/assets/") ? 4 : 12
    const jitter = Math.floor(Math.random() * 8)
    setTimeout(() => {
      if (path === "/") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" })
        res.end(DEMO_HTML)
      } else if (path === "/api/health") {
        res.writeHead(200, { "content-type": "application/json" })
        res.end(JSON.stringify({ ok: true }))
      } else if (path === "/api/profile") {
        res.writeHead(200, { "content-type": "application/json" })
        res.end(JSON.stringify({ user: null }))
      } else if (path === "/api/contact" && req.method === "POST") {
        let body = ""
        req.on("data", (c) => (body += c))
        req.on("end", () => {
          res.writeHead(200, { "content-type": "application/json" })
          res.end(JSON.stringify({ ok: true, received: body.length }))
        })
      } else if (path === "/slow") {
        res.writeHead(200, { "content-type": "text/plain" })
        res.end("slow")
      } else if (path === "/assets/app.js") {
        res.writeHead(200, { "content-type": "text/javascript" })
        res.end(DEMO_JS)
      } else {
        res.writeHead(404, { "content-type": "text/plain" })
        res.end("not found")
      }
    }, delay + jitter)
  })
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address()
      resolve({ server, target: `http://127.0.0.1:${port}` })
    })
  })
}

function demoConfig(target, args) {
  const raw = {
    name: "demo",
    target,
    concurrency: Number(args.concurrency ?? 10),
    rps: Number(args.rps ?? 0),
    duration: args.duration ?? "5s",
    rampSec: args.ramp ?? 0,
    warmupMs: args.warmup ?? 0,
    timeoutMs: args.timeout ?? 10_000,
    endpoints: [
      { path: "/", weight: 4 },
      { path: "/api/health", weight: 3 },
      { path: "/api/profile", weight: 2 },
      { path: "/assets/app.js", weight: 2 },
      { path: "/slow", weight: 1 },
      {
        path: "/api/contact",
        method: "POST",
        weight: 1,
        body: { email: "load@example.com", message: "demo" },
      },
    ],
  }
  return loadConfigRaw(raw)
}

// ---------------------------------------------------------------------------
// engine
// ---------------------------------------------------------------------------

function pickEndpoint(endpoints, rand) {
  const total = endpoints.reduce((s, ep) => s + ep.weight, 0)
  let r = rand() * total
  for (const ep of endpoints) {
    r -= ep.weight
    if (r <= 0) return ep
  }
  return endpoints[endpoints.length - 1]
}

// Simple deterministic PRNG so runs are reproducible-ish without imports.
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

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms)
    promise.then(
      (v) => {
        clearTimeout(t)
        resolve(v)
      },
      (e) => {
        clearTimeout(t)
        reject(e)
      },
    )
  })
}

async function doRequest(cfg, ep, timeoutMs) {
  const url = ep.path.startsWith("http") ? ep.path : cfg.target + ep.path
  const headers = { ...cfg.headers, ...ep.headers }
  let body
  if (ep.body != null) {
    body = typeof ep.body === "string" ? ep.body : JSON.stringify(ep.body)
    if (!headers["content-type"] && !headers["Content-Type"]) {
      headers["content-type"] = "application/json"
    }
  }
  const started = performance.now()
  try {
    const res = await withTimeout(
      fetch(url, { method: ep.method, headers, body, redirect: "follow" }),
      timeoutMs,
    )
    // Drain the body so keep-alive sockets stay healthy; we don't need it.
    await res.arrayBuffer().catch(() => {})
    const ms = performance.now() - started
    const ok = ep.expect.includes(res.status)
    return {
      ep: ep.key,
      status: res.status,
      ms,
      ok,
      error: ok ? null : `unexpected status ${res.status}`,
    }
  } catch (err) {
    const ms = performance.now() - started
    return {
      ep: ep.key,
      status: 0,
      ms,
      ok: false,
      error: err.message === "timeout" ? "timeout" : `network: ${err.message}`,
    }
  }
}

function percentile(sorted, p) {
  if (sorted.length === 0) return null
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
  return sorted[Math.max(0, idx)]
}

function summarize(samples, elapsedMs) {
  const byEp = new Map()
  for (const s of samples) {
    if (!byEp.has(s.ep)) byEp.set(s.ep, [])
    byEp.get(s.ep).push(s)
  }
  const summarizeGroup = (list, label) => {
    const lat = list.map((s) => s.ms).sort((a, b) => a - b)
    const errors = list.filter((s) => !s.ok)
    const statuses = {}
    for (const s of list) statuses[s.status] = (statuses[s.status] ?? 0) + 1
    return {
      label,
      count: list.length,
      errors: errors.length,
      errorRate: list.length ? errors.length / list.length : 0,
      rps: elapsedMs > 0 ? list.length / (elapsedMs / 1000) : 0,
      minMs: lat.length ? lat[0] : null,
      p50Ms: percentile(lat, 50),
      p95Ms: percentile(lat, 95),
      p99Ms: percentile(lat, 99),
      maxMs: lat.length ? lat[lat.length - 1] : null,
      meanMs: lat.length ? lat.reduce((a, b) => a + b, 0) / lat.length : null,
      statuses,
      errorKinds: errors.reduce((m, s) => {
        const k = s.error ?? "unexpected status"
        m[k] = (m[k] ?? 0) + 1
        return m
      }, {}),
    }
  }
  return {
    overall: summarizeGroup(samples, "all"),
    endpoints: [...byEp.entries()]
      .map(([label, list]) => summarizeGroup(list, label))
      .sort((a, b) => a.label.localeCompare(b.label)),
  }
}

async function runLoad(cfg) {
  const deadline = Date.now() + cfg.durationMs
  const warmupEnd = Date.now() + cfg.warmupMs
  const samples = []
  const rand = mulberry32(12345 + cfg.concurrency * 7 + cfg.durationMs)
  const startedAt = Date.now()

  const worker = async (idx) => {
    // During ramp-up, worker idx only starts once its stagger point passes.
    if (cfg.rampMs > 0) {
      const stagger = (cfg.rampMs / cfg.concurrency) * idx
      const wait = stagger - (Date.now() - startedAt)
      if (wait > 0) await new Promise((r) => setTimeout(r, wait))
    }
    while (Date.now() < deadline) {
      const activeWorkers =
        cfg.rampMs > 0
          ? Math.min(
              cfg.concurrency,
              Math.floor(((Date.now() - startedAt) / cfg.rampMs) * cfg.concurrency) + 1,
            )
          : cfg.concurrency
      const ep = pickEndpoint(cfg.endpoints, rand)
      // Pace from request start so `rps` approximates the achieved rate when
      // the target is below server capacity.
      const intervalMs = cfg.rps > 0 ? (activeWorkers / cfg.rps) * 1000 : 0
      const t0 = Date.now()
      const s = await doRequest(cfg, ep, cfg.timeoutMs)
      if (Date.now() >= warmupEnd) samples.push(s)
      if (intervalMs > 0) {
        const wait = intervalMs - (Date.now() - t0)
        if (wait > 0) await new Promise((r) => setTimeout(r, wait))
      }
    }
  }

  const workers = Array.from({ length: cfg.concurrency }, (_, i) => worker(i))
  await Promise.all(workers)

  const elapsedMs = Date.now() - Math.max(startedAt, warmupEnd)
  return { samples, elapsedMs, concurrency: cfg.concurrency, durationMs: cfg.durationMs }
}

// ---------------------------------------------------------------------------
// reporting
// ---------------------------------------------------------------------------

function fmtMs(v) {
  return v == null ? "-" : `${v.toFixed(v < 10 ? 1 : 0)}ms`
}

function fmtPct(v) {
  return v == null ? "-" : `${(v * 100).toFixed(2)}%`
}

function markdownReport(cfg, result, summary) {
  const o = summary.overall
  const lines = []
  lines.push(`# Load test report — ${cfg.name}`)
  lines.push("")
  lines.push(`- target: \`${cfg.target}\``)
  lines.push(
    `- users: ${cfg.concurrency} · duration: ${cfg.durationMs / 1000}s · rps target: ${cfg.rps || "unthrottled"}`,
  )
  lines.push(`- samples: ${o.count} · errors: ${o.errors} (${fmtPct(o.errorRate)})`)
  lines.push(
    `- achieved: ${o.rps.toFixed(1)} req/s · latency p50 ${fmtMs(o.p50Ms)} / p95 ${fmtMs(o.p95Ms)} / p99 ${fmtMs(o.p99Ms)} / max ${fmtMs(o.maxMs)}`,
  )
  lines.push("")
  lines.push("| endpoint | count | errors | err% | rps | p50 | p95 | p99 | max |")
  lines.push("|---|---|---|---|---|---|---|---|---|")
  for (const ep of summary.endpoints) {
    lines.push(
      `| \`${ep.label}\` | ${ep.count} | ${ep.errors} | ${fmtPct(ep.errorRate)} | ${ep.rps.toFixed(1)} | ${fmtMs(ep.p50Ms)} | ${fmtMs(ep.p95Ms)} | ${fmtMs(ep.p99Ms)} | ${fmtMs(ep.maxMs)} |`,
    )
  }
  const kinds = Object.entries(o.errorKinds)
  if (kinds.length) {
    lines.push("")
    lines.push("Error breakdown:")
    for (const [k, n] of kinds.sort((a, b) => b[1] - a[1])) lines.push(`- ${k}: ${n}`)
  }
  lines.push("")
  return lines.join("\n")
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log(USAGE)
    return
  }

  let cfg
  let demoServer = null
  if (args.demo) {
    const { server, target } = await startDemoServer()
    demoServer = server
    cfg = demoConfig(target, args)
    if (args.name) cfg.name = args.name
  } else if (args.config) {
    cfg = loadConfig(args.config, args)
    if (args.name) cfg.name = args.name
  } else {
    cfg = adHocConfig(args)
    if (args.name) cfg.name = args.name
  }

  // Validate numeric knobs.
  if (!(cfg.concurrency > 0)) throw new Error("concurrency must be > 0")
  if (!(cfg.durationMs > 0)) throw new Error("duration must be > 0")
  if (cfg.rps < 0) throw new Error("rps must be >= 0")

  console.error(
    `load: ${cfg.name} → ${cfg.target} (${cfg.concurrency} users, ${cfg.durationMs / 1000}s` +
      `${cfg.rps ? `, ${cfg.rps} rps` : ""}${cfg.rampMs ? `, ramp ${cfg.rampMs / 1000}s` : ""})`,
  )

  const result = await runLoad(cfg)
  const summary = summarize(result.samples, result.elapsedMs)

  if (args.out) {
    mkdirSync(dirname(args.out), { recursive: true })
    const report = {
      version: 1,
      scenario: cfg.name,
      target: cfg.target,
      config: {
        concurrency: cfg.concurrency,
        rps: cfg.rps,
        durationMs: cfg.durationMs,
        rampMs: cfg.rampMs,
        warmupMs: cfg.warmupMs,
        timeoutMs: cfg.timeoutMs,
      },
      elapsedMs: result.elapsedMs,
      summary,
      samples: result.samples,
    }
    writeFileSync(args.out, JSON.stringify(report, null, 2) + "\n")
    console.error(`load: JSON report → ${args.out}`)
  }

  console.log(markdownReport(cfg, result, summary))

  if (demoServer) demoServer.close()

  // Non-zero exit on total failure so CI can gate on it.
  if (summary.overall.count > 0 && summary.overall.errorRate >= 1) {
    process.exitCode = 1
  }
}

try {
  await main()
} catch (error) {
  console.error(`load: ${error.message}`)
  process.exitCode = 1
}
