#!/usr/bin/env node
// Capacity planner for the single-host Spindle origin stack.
//
//   node scripts/capacity/calc.mjs --demo
//   node scripts/capacity/calc.mjs --input scripts/capacity/input.example.json
//   node scripts/capacity/calc.mjs --rps-ceiling 850 --rps-target 1200 \
//       --growth 15 --db-max-connections 100 --pool-max 10
//
// Inputs come from CLI flags or a JSON file (--input). There are no env vars
// by design: capacity numbers are reviewed artifacts, not runtime config.
//
// What it models (see docs/capacity/model.md for the derivation):
//   * max sustainable RPS = measured load-test ceiling discounted by reserved
//     headroom (worker, backups, deploys, traffic spikes);
//   * Postgres connection budget = poolMax x DB-touching processes
//     (app replicas x processes, worker, read-replica pools) + reserved
//     superuser/migration/admin connections, checked against max_connections;
//   * scaling recommendation: vertical vs app replicas vs read replicas,
//     driven by which resource binds first.
//
// A load.mjs --out report can supply the ceiling automatically:
//   node scripts/perf/load.mjs --config scripts/perf/scenarios/mixed-traffic.json \
//       --out reports/load.json
//   node scripts/capacity/calc.mjs --load-report reports/load.json --rps-target 500
//
// JSON input schema (all numbers, all optional — defaults shown):
//   {
//     "currentRps": 120,          // measured/estimated current request rate
//     "targetRps": 500,           // desired sustained RPS (or omit + growthPct)
//     "growthPct": 15,            // % growth per growthPeriodMonths
//     "growthPeriodMonths": 3,
//     "rpsCeiling": 850,          // max RPS observed in load tests
//     "headroomPct": 30,          // % of ceiling reserved for non-peak work
//     "dbMaxConnections": 100,    // Postgres max_connections (default 100)
//     "poolMax": 10,              // DATABASE_POOL_MAX per process
//     "appReplicas": 1,           // app container replicas on the host
//     "appProcessesPerReplica": 1,// Node processes per app container
//     "workerProcesses": 1,       // worker containers/processes with a pool
//     "readReplicas": 0,          // REPLICA_DATABASE_URLS entries per process
//     "replicaPrimaryFallback": true, // replica pool also pools the primary
//     "reservedConnections": 10,  // superuser + migrations + admin headroom
//     "readPct": 80,              // % of DB work that is replica-safe reads
//     "p95BudgetMs": 500          // latency budget used to judge "passing" runs
//   }

import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { dirname } from "node:path"

// ---------------------------------------------------------------------------
// args / config
// ---------------------------------------------------------------------------

const DEFAULTS = {
  currentRps: 0,
  targetRps: null,
  growthPct: 0,
  growthPeriodMonths: 3,
  rpsCeiling: null,
  headroomPct: 30,
  dbMaxConnections: 100, // postgres:17 default max_connections
  poolMax: 10, // DATABASE_POOL_MAX default in src/lib/db/pool.ts
  appReplicas: 1,
  appProcessesPerReplica: 1,
  workerProcesses: 1,
  readReplicas: 0,
  replicaPrimaryFallback: true,
  reservedConnections: 10,
  readPct: 80,
  p95BudgetMs: 500,
}

function parseArgs(argv) {
  const args = { _: [], loadReports: [] }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (!arg.startsWith("--")) {
      args._.push(arg)
      continue
    }
    const eq = arg.indexOf("=")
    const key = eq === -1 ? arg.slice(2) : arg.slice(2, eq)
    const value = eq === -1 ? argv[++i] : arg.slice(eq + 1)
    if (["demo", "help", "no-replica-fallback"].includes(key)) args[key] = true
    else if (key === "load-report") args.loadReports.push(value)
    else {
      if (!KNOWN_FLAGS.has(key)) {
        console.error(`capacity: warning: ignoring unknown flag --${key}`)
      }
      args[key] = value
    }
  }
  return args
}

const USAGE = `Usage:
  node scripts/capacity/calc.mjs --demo
  node scripts/capacity/calc.mjs --input <config.json> [--out <report.json>]
  node scripts/capacity/calc.mjs [options]

Options:
  --input <file>          JSON config (schema in the script header)
  --load-report <file>    load.mjs --out JSON report; supplies rpsCeiling
                          (repeatable — the best passing run wins)
  --current-rps <n>       Current measured/estimated request rate
  --target-rps <n>        Desired sustained request rate
  --growth <pct>          Traffic growth % per --growth-period
  --growth-period <n>     Months per growth interval (default 3)
  --rps-ceiling <n>       Max RPS observed in load tests (required unless
                          --load-report or --demo)
  --headroom <pct>        % of ceiling reserved for non-peak work (default 30)
  --db-max-connections <n> Postgres max_connections (default 100)
  --pool-max <n>          DATABASE_POOL_MAX per process (default 10)
  --app-replicas <n>      App container replicas (default 1)
  --app-processes <n>     Node processes per app container (default 1)
  --worker-processes <n>  Worker processes holding a DB pool (default 1)
  --read-replicas <n>     Read replicas per app process (REPLICA_DATABASE_URLS)
  --no-replica-fallback   Replica pool has no primary fallback pool
  --reserved-connections <n> Superuser/migration/admin headroom (default 10)
  --read-pct <n>          % of DB work safe for read replicas (default 80)
  --p95-budget <ms>       p95 latency that marks a load run "passing" (500)
  --out <file.json>       Also write the full result as JSON
  --demo                  Run with built-in sample data (offline)
  --help                  Show this help
`

// CLI flag name -> config key.
const FLAG_MAP = {
  "current-rps": "currentRps",
  "target-rps": "targetRps",
  growth: "growthPct",
  "growth-period": "growthPeriodMonths",
  "rps-ceiling": "rpsCeiling",
  headroom: "headroomPct",
  "db-max-connections": "dbMaxConnections",
  "pool-max": "poolMax",
  "app-replicas": "appReplicas",
  "app-processes": "appProcessesPerReplica",
  "worker-processes": "workerProcesses",
  "read-replicas": "readReplicas",
  "reserved-connections": "reservedConnections",
  "read-pct": "readPct",
  "p95-budget": "p95BudgetMs",
}

const KNOWN_FLAGS = new Set([
  ...Object.keys(FLAG_MAP),
  "demo",
  "help",
  "input",
  "out",
  "load-report",
  "no-replica-fallback",
])

const NUMERIC_KEYS = new Set(Object.keys(DEFAULTS))

function num(value, name) {
  const n = Number(value)
  if (!Number.isFinite(n)) throw new Error(`${name}: expected a number, got "${value}"`)
  return n
}

function loadInput(args) {
  const cfg = { ...DEFAULTS }
  if (args.input) {
    const raw = JSON.parse(readFileSync(args.input, "utf8"))
    for (const k of NUMERIC_KEYS) {
      if (raw[k] != null) cfg[k] = num(raw[k], k)
    }
    if (raw.replicaPrimaryFallback === false) cfg.replicaPrimaryFallback = false
  }
  for (const [flag, key] of Object.entries(FLAG_MAP)) {
    if (args[flag] != null) cfg[key] = num(args[flag], `--${flag}`)
  }
  if (args["no-replica-fallback"]) cfg.replicaPrimaryFallback = false
  return cfg
}

// ---------------------------------------------------------------------------
// load.mjs report ingestion
// ---------------------------------------------------------------------------

// A run "passes" when its error rate is low and p95 is within budget; the
// ceiling is the highest achieved RPS among passing reports.
function ceilingFromReport(path, cfg) {
  const report = JSON.parse(readFileSync(path, "utf8"))
  const o = report?.summary?.overall
  if (!o) throw new Error(`${path}: no summary.overall — is this a load.mjs --out report?`)
  const passing = o.errorRate <= 0.05 && (o.p95Ms == null || o.p95Ms <= cfg.p95BudgetMs)
  return {
    path,
    rps: o.rps,
    p95Ms: o.p95Ms,
    errorRate: o.errorRate,
    passing,
  }
}

function resolveCeiling(cfg, reports) {
  const candidates = [...reports]
  if (cfg.rpsCeiling != null) {
    candidates.unshift({
      path: "--rps-ceiling",
      rps: cfg.rpsCeiling,
      p95Ms: null,
      errorRate: 0,
      passing: true,
    })
  }
  if (candidates.length === 0) {
    throw new Error("no RPS ceiling: pass --rps-ceiling <n>, --load-report <file>, or use --demo")
  }
  const passing = candidates.filter((c) => c.passing)
  const pool = passing.length ? passing : candidates
  const best = pool.reduce((a, b) => (b.rps > a.rps ? b : a))
  const failedOnly = passing.length === 0
  return { ceiling: best.rps, source: best, failedOnly, all: candidates }
}

// ---------------------------------------------------------------------------
// model
// ---------------------------------------------------------------------------

function compute(cfg, ceilingInfo) {
  const headroomFactor = 1 - cfg.headroomPct / 100
  const sustainableRps = ceilingInfo.ceiling * headroomFactor

  // Target: explicit, or projected from currentRps + growthPct per period.
  let targetRps = cfg.targetRps
  let projection = null
  if (targetRps == null && cfg.growthPct > 0 && cfg.currentRps > 0) {
    const periods = 4 // project 12 months out at growthPeriodMonths cadence
    const horizonMonths = cfg.growthPeriodMonths * periods
    targetRps = cfg.currentRps * (1 + cfg.growthPct / 100) ** periods
    projection = { horizonMonths, periods }
  }
  if (targetRps == null) targetRps = cfg.currentRps

  const rpsHeadroom = sustainableRps - targetRps
  const monthsToCap =
    cfg.growthPct > 0 && targetRps < sustainableRps && cfg.currentRps > 0
      ? (Math.log(sustainableRps / cfg.currentRps) / Math.log(1 + cfg.growthPct / 100)) *
        cfg.growthPeriodMonths
      : null

  // --- DB connection budget -------------------------------------------------
  // Per app process: 1 primary pool (src/lib/db.ts) +, when read replicas are
  // configured, one pool per replica URL plus one primary fallback pool
  // (src/lib/db/replica/replica-client.ts builds one pg.Pool per endpoint,
  // replicas first, primary last — see docs/database/read-replicas.md).
  const appProcesses = cfg.appReplicas * cfg.appProcessesPerReplica
  const replicaPoolsPerAppProcess =
    cfg.readReplicas > 0 ? cfg.readReplicas + (cfg.replicaPrimaryFallback ? 1 : 0) : 0
  const connections =
    appProcesses * cfg.poolMax * (1 + replicaPoolsPerAppProcess) +
    cfg.workerProcesses * cfg.poolMax +
    cfg.reservedConnections
  const dbUtilization = connections / cfg.dbMaxConnections
  const dbHeadroom = cfg.dbMaxConnections * 0.8 // keep >=20% free
  const dbOk = connections <= dbHeadroom

  // Replica-safe read share of DB work, for the read-replica recommendation.
  const replicaSafeRps = targetRps * (cfg.readPct / 100)

  // --- recommendation -------------------------------------------------------
  const recs = []
  if (dbUtilization > 1) {
    recs.push({
      severity: "blocker",
      action: "reduce-pool",
      text:
        `Connection budget exceeds max_connections (${connections}/${cfg.dbMaxConnections}). ` +
        `Lower DATABASE_POOL_MAX, reduce app replicas/processes, or raise max_connections ` +
        `before any traffic growth.`,
    })
  } else if (!dbOk) {
    recs.push({
      severity: "warn",
      action: "reduce-pool",
      text:
        `Connection budget uses ${Math.round(dbUtilization * 100)}% of max_connections ` +
        `(budget cap is 80%). Lower DATABASE_POOL_MAX or reservedConnections.`,
    })
  }

  if (targetRps > sustainableRps) {
    if (dbUtilization > 0.7) {
      recs.push({
        severity: "action",
        action: "vertical-then-replicas",
        text:
          `Target ${fmtRps(targetRps)} exceeds sustainable ${fmtRps(sustainableRps)} and the DB ` +
          `connection budget is already ${Math.round(dbUtilization * 100)}% consumed. ` +
          `Scale the host vertically (bigger Hetzner box raises CPU/RAM and can raise ` +
          `max_connections) before adding app replicas — replicas share the same ` +
          `Postgres and host CPU.`,
      })
    } else {
      recs.push({
        severity: "action",
        action: "vertical",
        text:
          `Target ${fmtRps(targetRps)} exceeds sustainable ${fmtRps(sustainableRps)}. ` +
          `The origin is a single Docker host (infra/origin/compose.yaml), so vertical ` +
          `scale-up of the Hetzner box is the first lever; adding app replicas on the ` +
          `same host only helps if a single Node process is the bottleneck.`,
      })
    }
    if (cfg.readReplicas === 0 && replicaSafeRps > sustainableRps * 0.5) {
      recs.push({
        severity: "info",
        action: "read-replicas",
        text:
          `~${Math.round(cfg.readPct)}% of DB work (${fmtRps(replicaSafeRps)}) is replica-safe ` +
          `per docs/database/read-replicas.md. If primary DB CPU/IO binds before app CPU, ` +
          `provision 1 read replica and route safe reads via REPLICA_DATABASE_URLS ` +
          `(+${cfg.poolMax * appProcesses} connections/process set — recheck the budget).`,
      })
    }
  } else if (monthsToCap != null && monthsToCap < 12) {
    recs.push({
      severity: "info",
      action: "plan-scale",
      text:
        `At ${cfg.growthPct}% growth per ${cfg.growthPeriodMonths}mo the ceiling is reached ` +
        `in ~${Math.round(monthsToCap)} months. Book a capacity review ` +
        `(docs/capacity/review.md) before then.`,
    })
  }

  if (recs.length === 0) {
    recs.push({
      severity: "ok",
      action: "none",
      text: `Headroom is comfortable: ${fmtRps(rpsHeadroom)} sustainable above target.`,
    })
  }

  return {
    sustainableRps,
    targetRps,
    rpsHeadroom,
    monthsToCap,
    projection,
    connections: {
      appProcesses,
      replicaPoolsPerAppProcess,
      total: connections,
      max: cfg.dbMaxConnections,
      utilization: dbUtilization,
      ok: dbOk,
      formula:
        `poolMax(${cfg.poolMax}) x [appProcesses(${appProcesses}) x (1 + replicaPools(${replicaPoolsPerAppProcess})) ` +
        `+ workerProcesses(${cfg.workerProcesses})] + reserved(${cfg.reservedConnections})`,
    },
    replicaSafeRps,
    recs,
  }
}

// ---------------------------------------------------------------------------
// reporting
// ---------------------------------------------------------------------------

function fmtRps(v) {
  return v == null ? "-" : `${v >= 100 ? Math.round(v) : v.toFixed(1)} rps`
}

function markdownReport(cfg, ceilingInfo, result) {
  const lines = []
  lines.push("# Capacity report")
  lines.push("")
  lines.push("## Inputs")
  lines.push("")
  lines.push(`- RPS ceiling (load tests): **${fmtRps(ceilingInfo.ceiling)}**`)
  lines.push(
    `  - source: \`${ceilingInfo.source.path}\`` +
      (ceilingInfo.source.p95Ms != null
        ? ` (achieved ${ceilingInfo.source.rps.toFixed(1)} rps, p95 ${ceilingInfo.source.p95Ms.toFixed(0)}ms, err ${(ceilingInfo.source.errorRate * 100).toFixed(2)}%)`
        : ""),
  )
  if (ceilingInfo.failedOnly) {
    lines.push(
      `  - ⚠ no load report passed the ${cfg.p95BudgetMs}ms p95 / 5% error budget; using the best observed run`,
    )
  }
  lines.push(`- headroom reserved: ${cfg.headroomPct}%`)
  lines.push(`- current RPS: ${fmtRps(cfg.currentRps)}`)
  if (result.projection) {
    lines.push(
      `- target RPS: ${fmtRps(result.targetRps)} (projected ${result.projection.periods} growth periods = ${result.projection.horizonMonths}mo)`,
    )
  } else {
    lines.push(`- target RPS: ${fmtRps(cfg.targetRps ?? cfg.currentRps)}`)
  }
  if (cfg.growthPct > 0) {
    lines.push(`- growth: ${cfg.growthPct}% per ${cfg.growthPeriodMonths} months`)
  }
  lines.push("")
  lines.push("## Result")
  lines.push("")
  lines.push(`- **Max sustainable RPS: ${fmtRps(result.sustainableRps)}**`)
  lines.push(
    `- headroom above target: ${fmtRps(result.rpsHeadroom)}` +
      (result.monthsToCap != null
        ? ` (~${Math.round(result.monthsToCap)} months at current growth)`
        : ""),
  )
  lines.push("")
  lines.push("## Database connection budget")
  lines.push("")
  lines.push(`- formula: \`${result.connections.formula}\``)
  lines.push(
    `- projected: **${result.connections.total}** connections vs max_connections **${result.connections.max}** (${Math.round(result.connections.utilization * 100)}% used, budget cap 80%) — ${result.connections.ok ? "OK" : "OVER BUDGET"}`,
  )
  lines.push("")
  lines.push("## Recommendations")
  lines.push("")
  for (const r of result.recs) {
    lines.push(`- **[${r.severity}] ${r.action}** — ${r.text}`)
  }
  lines.push("")
  lines.push("> Model assumptions and caveats: docs/capacity/model.md")
  lines.push("> Re-run triggers: docs/capacity/review.md")
  lines.push("")
  return lines.join("\n")
}

// ---------------------------------------------------------------------------
// demo
// ---------------------------------------------------------------------------

const DEMO_INPUT = {
  currentRps: 120,
  growthPct: 15,
  growthPeriodMonths: 3,
  rpsCeiling: 850,
  headroomPct: 30,
  dbMaxConnections: 100,
  poolMax: 10,
  appReplicas: 1,
  appProcessesPerReplica: 1,
  workerProcesses: 1,
  readReplicas: 0,
  reservedConnections: 10,
  readPct: 80,
}

function demoReport() {
  const cfg = { ...DEFAULTS, ...DEMO_INPUT }
  const ceilingInfo = resolveCeiling(cfg, [])
  const result = compute(cfg, ceilingInfo)
  console.log(markdownReport(cfg, ceilingInfo, result))
  // Also show the "what if we add a replica" variant so --demo exercises the
  // read-replica budget path.
  const scaled = { ...DEFAULTS, ...DEMO_INPUT, readReplicas: 1, appReplicas: 2 }
  const scaledInfo = resolveCeiling(scaled, [])
  console.log("---\n")
  console.log("## Variant: 2 app replicas + 1 read replica (budget check only)")
  console.log("")
  const r = compute(scaled, scaledInfo)
  console.log(
    `- connections: **${r.connections.total}** / ${r.connections.max} (${Math.round(r.connections.utilization * 100)}%) — ${r.connections.ok ? "OK" : "OVER BUDGET"}`,
  )
  console.log(`- formula: \`${r.connections.formula}\``)
  console.log("")
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log(USAGE)
    return
  }

  let cfg
  let reports = []
  if (args.demo) {
    demoReport()
    return
  }

  cfg = loadInput(args)
  reports = args.loadReports.map((p) => ceilingFromReport(p, cfg))
  const ceilingInfo = resolveCeiling(cfg, reports)
  const result = compute(cfg, ceilingInfo)

  console.log(markdownReport(cfg, ceilingInfo, result))

  if (args.out) {
    mkdirSync(dirname(args.out), { recursive: true })
    writeFileSync(
      args.out,
      JSON.stringify({ version: 1, inputs: cfg, ceiling: ceilingInfo, result }, null, 2) + "\n",
    )
    console.error(`capacity: JSON report → ${args.out}`)
  }

  // Exit non-zero when the budget is blown so CI/review can gate on it.
  if (!result.connections.ok || result.recs.some((r) => r.severity === "blocker")) {
    process.exitCode = 1
  }
}

try {
  main()
} catch (error) {
  console.error(`capacity: ${error.message}`)
  process.exitCode = 1
}
