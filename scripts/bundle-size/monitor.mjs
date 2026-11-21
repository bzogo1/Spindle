#!/usr/bin/env node
// Bundle-size monitor: measures total and per-route client JS/CSS from the
// .next build manifests, records gzip-sized snapshots to a JSONL history,
// and compares the current build against budgets + the previous snapshot.
//
// Usage:
//   node scripts/bundle-size/monitor.mjs [options]
//
// Options:
//   --demo               run fully offline on synthetic data; never touches
//                        .next or history.jsonl
//   --budgets <path>     budgets JSON (default: scripts/bundle-size/budgets.json)
//   --history <path>     JSONL history file (default: scripts/bundle-size/history.jsonl)
//   --no-record          do not append this run to the history file
//   --top <n>            routes to list in the report (default: 15)
//
// Measurement, in priority order (same sources as check-client-bundle.mjs):
//   1. webpack builds: .next/app-build-manifest.json `pages[route].files`
//      ("/_next/..." entries resolved under .next/). Includes .js and .css,
//      so both JS+CSS and CSS-only per-route budgets apply.
//   2. Turbopack builds: .next/diagnostics/route-bundle-stats.json
//      `firstLoadChunkPaths` (".next/..." entries resolved under the repo
//      root). JS only — Turbopack does not attribute per-route CSS, so
//      per-route CSS budgets are skipped for Turbopack builds.
//   3. Neither file: exit 2 unless --demo.
//
// The "total" figure is every .js/.css under .next/static, gzip-compressed,
// including lazy chunks — the same set check-client-bundle.mjs enforces.
//
// Exit codes:
//   0  all budgets satisfied (warnings allowed)
//   1  at least one budget exceeded
//   2  usage error or no build data available
//
// Snapshot JSONL schema (one object per line):
//   {"ts","source","gitSha"?,"total":{"jsKb","cssKb","jsCssKb","fileCount"},
//    "routes":{"<route>":{"jsKb","cssKb","jsCssKb","fileCount"}}}

import fs from "node:fs"
import path from "node:path"
import { gzipSync } from "node:zlib"
import { fileURLToPath } from "node:url"

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(scriptDir, "..", "..")
const nextDir = path.join(root, ".next")
const staticDir = path.join(nextDir, "static")
const webpackManifestPath = path.join(nextDir, "app-build-manifest.json")
const turbopackStatsPath = path.join(nextDir, "diagnostics", "route-bundle-stats.json")

const ASSET_EXTENSIONS = new Set([".js", ".css"])

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { demo: false, record: true, top: 15 }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--demo") args.demo = true
    else if (arg === "--no-record") args.record = false
    else if (arg === "--budgets") args.budgets = argv[++i]
    else if (arg.startsWith("--budgets=")) args.budgets = arg.slice("--budgets=".length)
    else if (arg === "--history") args.history = argv[++i]
    else if (arg.startsWith("--history=")) args.history = arg.slice("--history=".length)
    else if (arg === "--top") args.top = Number(argv[++i])
    else if (arg.startsWith("--top=")) args.top = Number(arg.slice("--top=".length))
    else if (arg === "--help" || arg === "-h") args.help = true
    else {
      console.error(`monitor: unknown argument ${arg} (try --help)`)
      process.exit(2)
    }
  }
  args.budgets = path.resolve(args.budgets ?? path.join(scriptDir, "budgets.json"))
  args.history = path.resolve(args.history ?? path.join(scriptDir, "history.jsonl"))
  if (!Number.isInteger(args.top) || args.top < 1) {
    console.error(`monitor: --top must be a positive integer, got ${args.top}`)
    process.exit(2)
  }
  return args
}

const HELP = `Bundle size monitor — see header of scripts/bundle-size/monitor.mjs for details.
Options: --demo --budgets <path> --history <path> --no-record --top <n>`

// ---------------------------------------------------------------------------
// Measurement helpers
// ---------------------------------------------------------------------------

function gzipKb(file) {
  return gzipSync(fs.readFileSync(file)).length / 1024
}

/** Sum gzip sizes for a list of absolute file paths, deduped by extension pair. */
function measureFiles(files) {
  const seen = new Set()
  const out = { jsKb: 0, cssKb: 0, jsCssKb: 0, fileCount: 0 }
  for (const file of files) {
    const ext = path.extname(file)
    if (!ASSET_EXTENSIONS.has(ext)) continue
    const key = `${ext}:${file}`
    if (seen.has(key)) continue
    seen.add(key)
    if (!fs.existsSync(file)) continue
    const kb = gzipKb(file)
    out.jsCssKb += kb
    if (ext === ".css") out.cssKb += kb
    else out.jsKb += kb
    out.fileCount += 1
  }
  return out
}

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) yield* walk(full)
    else yield full
  }
}

// ---------------------------------------------------------------------------
// Real build data
// ---------------------------------------------------------------------------

function collectWebpack() {
  const manifest = JSON.parse(fs.readFileSync(webpackManifestPath, "utf8"))
  const pages = manifest.pages ?? {}
  const routes = {}
  for (const [route, page] of Object.entries(pages)) {
    const files = (page?.files ?? [])
      .filter((entry) => entry.startsWith("/_next/"))
      .map((entry) => path.join(nextDir, entry.slice("/_next/".length)))
    routes[route] = measureFiles(files)
  }
  return routes
}

function collectTurbopack() {
  const stats = JSON.parse(fs.readFileSync(turbopackStatsPath, "utf8"))
  if (!Array.isArray(stats)) throw new Error(`${turbopackStatsPath} is not an array`)
  const routes = {}
  for (const entry of stats) {
    if (!entry?.route) continue
    const files = (entry.firstLoadChunkPaths ?? []).map((p) => path.join(root, p))
    routes[entry.route] = measureFiles(files)
  }
  return routes
}

function collectTotal() {
  if (!fs.existsSync(staticDir)) return null
  const files = [...walk(staticDir)].filter((f) => ASSET_EXTENSIONS.has(path.extname(f)))
  return measureFiles(files)
}

function collectReal() {
  if (fs.existsSync(webpackManifestPath)) {
    return { source: "webpack", routes: collectWebpack() }
  }
  if (fs.existsSync(turbopackStatsPath)) {
    return { source: "turbopack", routes: collectTurbopack() }
  }
  return null
}

// ---------------------------------------------------------------------------
// Demo data (deterministic, offline)
// ---------------------------------------------------------------------------

function collectDemo() {
  // Plausible gzip KiB figures near the real baselines so the report and
  // budget logic exercise the same code paths as a real build.
  const routes = {
    "/": { jsKb: 388.2, cssKb: 31.4, jsCssKb: 419.6, fileCount: 24 },
    "/docs/[slug]": { jsKb: 402.7, cssKb: 33.1, jsCssKb: 435.8, fileCount: 26 },
    "/collaboration": { jsKb: 296.4, cssKb: 30.9, jsCssKb: 327.3, fileCount: 21 },
    "/pricing": { jsKb: 341.5, cssKb: 31.0, jsCssKb: 372.5, fileCount: 22 },
    "/sign-in": { jsKb: 210.3, cssKb: 29.8, jsCssKb: 240.1, fileCount: 18 },
    "/sign-up": { jsKb: 214.9, cssKb: 29.9, jsCssKb: 244.8, fileCount: 18 },
    "/app/dashboard": { jsKb: 471.2, cssKb: 32.6, jsCssKb: 503.8, fileCount: 30 },
    "/app/settings": { jsKb: 388.0, cssKb: 32.1, jsCssKb: 420.1, fileCount: 25 },
  }
  const total = { jsKb: 712.4, cssKb: 214.9, jsCssKb: 927.3, fileCount: 412 }
  return { source: "demo", routes, total }
}

function demoHistory() {
  // Two prior synthetic snapshots so regression warnings fire for the route
  // that grew ~9% (budget regression threshold is 5%).
  return [
    {
      ts: "2026-11-19T09:00:00.000Z",
      source: "demo",
      total: { jsKb: 700.1, cssKb: 210.4, jsCssKb: 910.5, fileCount: 408 },
      routes: {
        "/": { jsKb: 385.0, cssKb: 31.2, jsCssKb: 416.2, fileCount: 24 },
        "/app/dashboard": { jsKb: 430.0, cssKb: 32.0, jsCssKb: 462.0, fileCount: 29 },
      },
    },
    {
      ts: "2026-11-20T09:00:00.000Z",
      source: "demo",
      total: { jsKb: 706.2, cssKb: 212.7, jsCssKb: 918.9, fileCount: 410 },
      routes: {
        "/": { jsKb: 386.6, cssKb: 31.3, jsCssKb: 417.9, fileCount: 24 },
        "/app/dashboard": { jsKb: 428.0, cssKb: 32.0, jsCssKb: 460.0, fileCount: 29 },
      },
    },
  ]
}

// ---------------------------------------------------------------------------
// Budgets + history
// ---------------------------------------------------------------------------

function loadBudgets(file) {
  const budgets = JSON.parse(fs.readFileSync(file, "utf8"))
  budgets.routes = budgets.routes ?? {}
  budgets.defaultRoute = budgets.defaultRoute ?? { maxJsCssKb: Infinity, maxCssKb: Infinity }
  budgets.total = budgets.total ?? { maxJsCssKb: Infinity }
  budgets.regression = budgets.regression ?? { percent: 5 }
  return budgets
}

/** Exact match first, then "/prefix/*" wildcard keys, then defaultRoute. */
function budgetForRoute(budgets, route) {
  if (budgets.routes[route]) return budgets.routes[route]
  for (const [key, value] of Object.entries(budgets.routes)) {
    if (key.endsWith("/*") && route.startsWith(key.slice(0, -1))) return value
  }
  return budgets.defaultRoute
}

function readHistory(file) {
  if (!fs.existsSync(file)) return []
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      try {
        return JSON.parse(line)
      } catch {
        return null
      }
    })
    .filter(Boolean)
}

function appendHistory(file, snapshot) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.appendFileSync(file, JSON.stringify(snapshot) + "\n")
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

function checkBudgets(snapshot, budgets) {
  const failures = []
  const warnings = []

  const totalLimit = budgets.total.maxJsCssKb
  if (snapshot.total && totalLimit != null && snapshot.total.jsCssKb > totalLimit) {
    failures.push(
      `total: all .js/.css under .next/static ${snapshot.total.jsCssKb.toFixed(1)} KiB gzip > ${totalLimit} KiB budget`,
    )
  }

  for (const [route, size] of Object.entries(snapshot.routes).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const budget = budgetForRoute(budgets, route)
    const maxJsCss = budget.maxJsCssKb ?? Infinity
    if (size.jsCssKb > maxJsCss) {
      failures.push(
        `route ${route}: initial JS+CSS ${size.jsCssKb.toFixed(1)} KiB gzip > ${maxJsCss} KiB budget`,
      )
    }
    // Per-route CSS is only measurable on the webpack path (size.cssKb > 0
    // proves CSS files were attributed); Turbopack routes report cssKb 0.
    const maxCss = budget.maxCssKb ?? Infinity
    if (size.cssKb > 0 && size.cssKb > maxCss) {
      failures.push(`route ${route}: CSS ${size.cssKb.toFixed(1)} KiB gzip > ${maxCss} KiB budget`)
    }
    // Soft warning when a route is within 10% of its ceiling.
    if (maxJsCss !== Infinity && size.jsCssKb > maxJsCss * 0.9) {
      warnings.push(
        `route ${route}: ${size.jsCssKb.toFixed(1)} KiB gzip is within 10% of the ${maxJsCss} KiB budget`,
      )
    }
  }
  return { failures, warnings }
}

function checkRegression(snapshot, previous, budgets) {
  const warnings = []
  const pct = budgets.regression.percent ?? 5
  if (!previous) return warnings
  const grown = (label, cur, prev) => {
    if (!cur || !prev || prev <= 0) return
    const growth = ((cur - prev) / prev) * 100
    if (growth > pct) {
      warnings.push(
        `${label}: grew ${growth.toFixed(1)}% (${prev.toFixed(1)} → ${cur.toFixed(1)} KiB gzip) vs previous snapshot`,
      )
    }
  }
  grown("total JS+CSS", snapshot.total?.jsCssKb, previous.total?.jsCssKb)
  for (const [route, size] of Object.entries(snapshot.routes)) {
    grown(`route ${route}`, size.jsCssKb, previous.routes?.[route]?.jsCssKb)
  }
  return warnings
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

function fmt(kb) {
  return kb == null ? "—" : `${kb.toFixed(1)} KiB`
}

function printReport(snapshot, budgets, previous, failures, warnings, args) {
  const lines = []
  lines.push(`# Bundle size report (${snapshot.source})`)
  lines.push("")
  if (snapshot.total) {
    const t = snapshot.total
    lines.push(
      `Total .next/static JS+CSS: ${fmt(t.jsCssKb)} gzip ` +
        `(${t.fileCount} files · JS ${fmt(t.jsKb)} · CSS ${fmt(t.cssKb)})`,
    )
    const limit = budgets.total.maxJsCssKb
    if (limit != null) {
      lines.push(`Total budget: ${limit} KiB gzip`)
    }
  }
  lines.push("")

  const routes = Object.entries(snapshot.routes).sort(([, a], [, b]) => b.jsCssKb - a.jsCssKb)
  lines.push(`| # | Route | JS KiB | CSS KiB | JS+CSS KiB | Budget KiB |`)
  lines.push(`| - | ----- | ------ | -------- | ---------- | ---------- |`)
  routes.slice(0, args.top).forEach(([route, size], i) => {
    const limit = budgetForRoute(budgets, route).maxJsCssKb
    lines.push(
      `| ${i + 1} | \`${route}\` | ${fmt(size.jsKb)} | ${fmt(size.cssKb)} | ${fmt(size.jsCssKb)} | ${limit ?? "—"} |`,
    )
  })
  if (routes.length > args.top) {
    lines.push(`| … | +${routes.length - args.top} more routes | | | | |`)
  }
  lines.push("")

  if (previous) {
    lines.push(`Compared against previous snapshot: ${previous.ts ?? "unknown"}`)
  } else {
    lines.push("No previous snapshot in history — regression check skipped.")
  }
  lines.push("")

  if (failures.length > 0) {
    lines.push("## Budget failures")
    lines.push("")
    for (const f of failures) lines.push(`- ${f}`)
    lines.push("")
  }
  if (warnings.length > 0) {
    lines.push("## Warnings")
    lines.push("")
    for (const w of warnings) lines.push(`- ${w}`)
    lines.push("")
  }
  if (failures.length === 0 && warnings.length === 0) {
    lines.push("All budgets satisfied; no warnings.")
    lines.push("")
  }
  console.log(lines.join("\n"))
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log(HELP)
    return 0
  }

  const budgets = loadBudgets(args.budgets)

  let snapshot
  let previous
  let historyEntries

  if (args.demo) {
    const demo = collectDemo()
    snapshot = {
      ts: "2026-11-20T12:00:00.000Z",
      source: demo.source,
      total: demo.total,
      routes: demo.routes,
    }
    historyEntries = demoHistory()
    previous = historyEntries[historyEntries.length - 1]
  } else {
    const real = collectReal()
    if (!real) {
      console.error(
        "monitor: no build manifests found (.next/app-build-manifest.json or .next/diagnostics/route-bundle-stats.json). Run `npm run build` first, or use --demo.",
      )
      return 2
    }
    if (!fs.existsSync(staticDir)) {
      console.warn("monitor: WARN — .next/static not found; total measurement skipped.")
    }
    snapshot = {
      ts: new Date().toISOString(),
      source: real.source,
      total: collectTotal(),
      routes: real.routes,
    }
    historyEntries = readHistory(args.history)
    previous = historyEntries[historyEntries.length - 1] ?? null
  }

  const { failures, warnings: budgetWarnings } = checkBudgets(snapshot, budgets)
  const regressionWarnings = checkRegression(snapshot, previous, budgets)
  const warnings = [...budgetWarnings, ...regressionWarnings]

  if (args.record && !args.demo) {
    appendHistory(args.history, snapshot)
  }

  printReport(snapshot, budgets, previous, failures, warnings, args)

  if (failures.length > 0) {
    console.error(`monitor: FAIL — ${failures.length} budget(s) exceeded.`)
    return 1
  }
  console.log("monitor: OK")
  return 0
}

process.exit(main())
