// Shared logic for the performance benchmark suite.
//
// Snapshots are plain JSON objects describing the client payload of the
// current `.next` build plus optional runtime metrics (Lighthouse-style).
// `compare.mjs` diffs a snapshot against a stored baseline and enforces the
// budgets in `budgets.json`.
//
// Per-route client bytes are approximated from each page's
// `*_client-reference-manifest.js`: every `/_next/static/...` chunk referenced
// by a client module is summed (deduplicated per route). This includes shared
// framework chunks, which is intentional — it tracks what a route actually
// pulls into the browser, not just route-unique code.

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

export const BENCH_DIR = join(dirname(fileURLToPath(import.meta.url)), "..")
export const REPO_ROOT = join(BENCH_DIR, "..", "..", "..")
export const NEXT_DIR = join(REPO_ROOT, ".next")
export const BASELINES_DIR = join(BENCH_DIR, "baselines")
export const SNAPSHOTS_DIR = join(BENCH_DIR, "snapshots")
export const BUDGETS_PATH = join(BENCH_DIR, "budgets.json")

export const SNAPSHOT_VERSION = 1

// ---------------------------------------------------------------------------
// filesystem helpers
// ---------------------------------------------------------------------------

function walkFiles(dir, out = []) {
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) walkFiles(full, out)
    else if (entry.isFile()) out.push(full)
  }
  return out
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"))
}

// ---------------------------------------------------------------------------
// collection: real `.next` build
// ---------------------------------------------------------------------------

function collectStaticTotals() {
  const totals = { jsBytes: 0, cssBytes: 0, otherBytes: 0, fileCount: 0 }
  for (const file of walkFiles(join(NEXT_DIR, "static"))) {
    const size = statSync(file).size
    totals.fileCount += 1
    if (file.endsWith(".js")) totals.jsBytes += size
    else if (file.endsWith(".css")) totals.cssBytes += size
    else totals.otherBytes += size
  }
  return totals
}

// `app-path-routes-manifest.json` maps internal page paths
// (`/(site)/docs/[slug]/page`) to URL routes (`/docs/[slug]`). Each internal
// path has a sibling `*_client-reference-manifest.js` under
// `.next/server/app/` that lists the client chunks for that route.
function collectRoutes() {
  const manifestPath = join(NEXT_DIR, "app-path-routes-manifest.json")
  if (!existsSync(manifestPath)) return []
  const routesManifest = readJson(manifestPath)

  const routes = []
  for (const [internalPath, urlRoute] of Object.entries(routesManifest)) {
    if (!internalPath.endsWith("/page")) continue // skip route handlers/images
    // `/(site)/docs/[slug]/page` -> `.next/server/app/(site)/docs/[slug]/` +
    // `page_client-reference-manifest.js` (sibling of the `page/` dir).
    const segments = internalPath.split("/").filter(Boolean)
    const base = segments.pop()
    const pageParent = join(NEXT_DIR, "server", "app", ...segments)
    const refManifest = join(pageParent, `${base}_client-reference-manifest.js`)
    if (!existsSync(refManifest)) continue

    const content = readFileSync(refManifest, "utf8")
    const chunks = new Set()
    // Chunks appear both as "/_next/static/..." (client modules) and bare
    // "static/..." (entryCSSFiles); capture both, restricted to js/css assets.
    for (const match of content.matchAll(/"(?:\/_next\/)?(static\/[^"]+\.(?:js|css))"/g)) {
      chunks.add(match[1])
    }

    let jsBytes = 0
    let cssBytes = 0
    let missing = 0
    for (const chunk of chunks) {
      const file = join(NEXT_DIR, chunk)
      if (!existsSync(file)) {
        missing += 1
        continue
      }
      const size = statSync(file).size
      if (chunk.endsWith(".js")) jsBytes += size
      else if (chunk.endsWith(".css")) cssBytes += size
    }

    routes.push({
      route: urlRoute,
      jsBytes,
      cssBytes,
      jsChunkCount: [...chunks].filter((c) => c.endsWith(".js")).length,
      chunkCount: chunks.size,
      missingChunks: missing,
    })
  }

  return routes.sort((a, b) => b.jsBytes - a.jsBytes)
}

function loadBuildId() {
  const path = join(NEXT_DIR, "BUILD_ID")
  return existsSync(path) ? readFileSync(path, "utf8").trim() : null
}

function loadRuntimeMetrics(runtimePath) {
  if (!runtimePath) return null
  const data = readJson(runtimePath)
  // Accept either a flat metrics object or Lighthouse-style nested values.
  const pick = (obj, keys) => {
    for (const key of keys) {
      const value = obj?.[key]
      if (typeof value === "number" && Number.isFinite(value)) return value
    }
    return null
  }
  const flat = data.metrics ?? data
  const runtime = {
    ttfbMs: pick(flat, ["ttfbMs", "ttfb", "server-response-time"]),
    fcpMs: pick(flat, ["fcpMs", "first-contentful-paint", "firstContentfulPaint"]),
    lcpMs: pick(flat, ["lcpMs", "largest-contentful-paint", "largestContentfulPaint"]),
    tbtMs: pick(flat, ["tbtMs", "total-blocking-time", "totalBlockingTime"]),
    cls: pick(flat, ["cls", "cumulative-layout-shift", "cumulativeLayoutShift"]),
    inpMs: pick(flat, ["inpMs", "interaction-to-next-paint", "interactionToNextPaint"]),
  }
  return Object.values(runtime).some((v) => v != null) ? runtime : null
}

export function collectFromNext({ runtimePath = null } = {}) {
  if (!existsSync(join(NEXT_DIR, "BUILD_ID"))) {
    throw new Error(
      `.next build not found at ${NEXT_DIR}. Run \`npm run build\` first, ` +
        "or pass --demo for synthetic data.",
    )
  }
  const runtime = loadRuntimeMetrics(runtimePath)
  return {
    version: SNAPSHOT_VERSION,
    capturedAt: new Date().toISOString(),
    source: "next-build",
    buildId: loadBuildId(),
    totals: collectStaticTotals(),
    routes: collectRoutes(),
    runtime,
  }
}

// ---------------------------------------------------------------------------
// collection: synthetic demo data (fully offline)
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

const DEMO_ROUTES = [
  { route: "/", jsKb: 310 },
  { route: "/docs/[slug]", jsKb: 280 },
  { route: "/collaboration", jsKb: 380 },
  { route: "/pricing", jsKb: 190 },
  { route: "/sign-in", jsKb: 150 },
  { route: "/app", jsKb: 360 },
]

// `jitter` perturbs sizes deterministically; pass a map of route -> percent to
// force a specific regression/improvement for demos.
export function collectDemo({ seed = 42, jitter = 0, overrides = null } = {}) {
  const rand = mulberry32(seed)
  const routes = DEMO_ROUTES.map(({ route, jsKb }) => {
    const factor = 1 + (rand() - 0.5) * 0.08 + jitter
    const override = overrides?.[route]
    const finalKb = override != null ? jsKb * (1 + override / 100) : jsKb * factor
    const jsBytes = Math.round(finalKb * 1024)
    return {
      route,
      jsBytes,
      cssBytes: Math.round(jsBytes * 0.08),
      jsChunkCount: 8 + Math.floor(rand() * 10),
      chunkCount: 10 + Math.floor(rand() * 12),
      missingChunks: 0,
    }
  })

  const totalJs = routes.reduce((sum, r) => sum + r.jsBytes, 0)
  return {
    version: SNAPSHOT_VERSION,
    capturedAt: new Date().toISOString(),
    source: "demo",
    buildId: `demo-${seed}`,
    totals: {
      jsBytes: Math.round(totalJs * 1.35),
      cssBytes: Math.round(totalJs * 0.12),
      otherBytes: Math.round(totalJs * 0.4),
      fileCount: routes.length * 14 + 120,
    },
    routes,
    runtime: {
      ttfbMs: 180,
      fcpMs: 900,
      lcpMs: 2100,
      tbtMs: 120,
      cls: 0.04,
      inpMs: 160,
    },
  }
}

export function collectSnapshot({ demo = false, runtimePath = null, demoSeed = 42 } = {}) {
  return demo ? collectDemo({ seed: demoSeed }) : collectFromNext({ runtimePath })
}

// ---------------------------------------------------------------------------
// budgets + diffing
// ---------------------------------------------------------------------------

export function loadBudgets(path = BUDGETS_PATH) {
  if (!existsSync(path)) {
    throw new Error(`Budgets config not found at ${path}`)
  }
  const budgets = readJson(path)
  budgets.regression ??= { percent: 5, absoluteKbSlack: 25 }
  budgets.bundle ??= { default: { maxJsKb: 500 }, routes: {} }
  budgets.runtime ??= {}
  return budgets
}

export function routeBudget(budgets, route) {
  const routes = budgets.bundle.routes ?? {}
  return routes[route] ?? routes["*"] ?? budgets.bundle.default ?? {}
}

function kb(bytes) {
  return bytes / 1024
}

function fmtKb(bytes) {
  return `${kb(bytes).toFixed(1)} kB`
}

function fmtPct(ratio) {
  const pct = (ratio - 1) * 100
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`
}

// Returns { rows, failures, warnings }. Each row:
// { metric, route, baseline, current, deltaBytes, deltaPct, status }
// status: "pass" | "regression" | "improved" | "new" | "removed" | "budget" | "runtime"
export function diffSnapshots(baseline, current, budgets) {
  const slackBytes = (budgets.regression.absoluteKbSlack ?? 25) * 1024
  const pctThreshold = (budgets.regression.percent ?? 5) / 100
  const failures = []
  const warnings = []
  const rows = []

  const isRegression = (base, cur) => base > 0 && cur > base * (1 + pctThreshold) + slackBytes

  const pushMetric = ({ metric, route, base, cur, unit = "bytes" }) => {
    const delta = cur - base
    const ratio = base > 0 ? cur / base : null
    let status = "pass"
    if (base == null) status = "new"
    else if (cur == null) status = "removed"
    else if (isRegression(base, cur)) status = "regression"
    else if (delta < 0) status = "improved"
    if (status === "regression") {
      failures.push(
        `${metric}${route ? ` ${route}` : " (total)"}: ${fmtKb(cur)} vs baseline ${fmtKb(base)} (${fmtPct(ratio)}) exceeds +${budgets.regression.percent}% + ${budgets.regression.absoluteKbSlack} kB slack`,
      )
    }
    rows.push({
      metric,
      route,
      baseline: base,
      current: cur,
      delta,
      deltaPct: ratio != null ? ratio - 1 : null,
      unit,
      status,
    })
  }

  // ---- bundle totals ----
  for (const key of ["jsBytes", "cssBytes", "otherBytes"]) {
    pushMetric({
      metric: `totals.${key}`,
      route: null,
      base: baseline.totals?.[key],
      cur: current.totals?.[key],
    })
  }

  // ---- per-route client chunks ----
  const baseRoutes = new Map((baseline.routes ?? []).map((r) => [r.route, r]))
  const curRoutes = new Map((current.routes ?? []).map((r) => [r.route, r]))
  const allRoutes = new Set([...baseRoutes.keys(), ...curRoutes.keys()])

  for (const route of [...allRoutes].sort()) {
    const base = baseRoutes.get(route)
    const cur = curRoutes.get(route)
    pushMetric({
      metric: "route.jsBytes",
      route,
      base: base?.jsBytes,
      cur: cur?.jsBytes,
    })
    pushMetric({
      metric: "route.cssBytes",
      route,
      base: base?.cssBytes,
      cur: cur?.cssBytes,
    })
  }

  // ---- absolute budgets (current snapshot only) ----
  for (const route of [...curRoutes.keys()].sort()) {
    const budget = routeBudget(budgets, route)
    const cur = curRoutes.get(route)
    if (budget.maxJsKb != null && cur.jsBytes > budget.maxJsKb * 1024) {
      failures.push(
        `budget ${route}: client JS ${fmtKb(cur.jsBytes)} exceeds maxJsKb ${budget.maxJsKb} kB`,
      )
      rows.push({
        metric: "budget.maxJsKb",
        route,
        baseline: budget.maxJsKb * 1024,
        current: cur.jsBytes,
        delta: cur.jsBytes - budget.maxJsKb * 1024,
        deltaPct: null,
        unit: "bytes",
        status: "budget",
      })
    }
  }

  // ---- runtime budgets + regression ----
  const runtimeBudget = budgets.runtime ?? {}
  const runtimeKeys = [
    ["ttfbMs", "ttfbMs"],
    ["fcpMs", "fcpMs"],
    ["lcpMs", "lcpMs"],
    ["tbtMs", "tbtMs"],
    ["cls", "cls"],
    ["inpMs", "inpMs"],
  ]
  for (const [metric, budgetKey] of runtimeKeys) {
    const base = baseline.runtime?.[metric]
    const cur = current.runtime?.[metric]
    const budget = runtimeBudget[budgetKey]
    if (cur == null) continue

    let status = "pass"
    if (budget != null && cur > budget) {
      status = "runtime"
      failures.push(`runtime budget ${metric}: ${cur} exceeds budget ${budget}`)
    } else if (base != null && base > 0 && cur > base * (1 + pctThreshold)) {
      status = "regression"
      failures.push(
        `runtime ${metric}: ${cur} vs baseline ${base} exceeds +${budgets.regression.percent}%`,
      )
    } else if (base != null && cur < base) {
      status = "improved"
    } else if (base == null) {
      status = "new"
    }
    if (status === "pass" && budget == null && base == null) {
      warnings.push(`runtime ${metric}: no baseline or budget to compare against`)
    }
    rows.push({
      metric: `runtime.${metric}`,
      route: null,
      baseline: base ?? null,
      current: cur,
      delta: base != null ? cur - base : null,
      deltaPct: base != null && base !== 0 ? cur / base - 1 : null,
      unit: metric === "cls" ? "ratio" : "ms",
      status,
    })
  }

  return { rows, failures, warnings }
}

export function formatDiff(result, { baselineLabel = "baseline", currentLabel = "current" } = {}) {
  const lines = []
  lines.push(`Benchmark diff: ${baselineLabel} → ${currentLabel}`)
  lines.push("")
  const icon = {
    pass: "·",
    improved: "↓",
    regression: "✗",
    new: "+",
    removed: "−",
    budget: "✗",
    runtime: "✗",
  }
  for (const row of result.rows) {
    const label = row.route ? `${row.metric} ${row.route}` : row.metric
    const cur =
      row.unit === "bytes"
        ? fmtKb(row.current ?? 0)
        : row.unit === "ms"
          ? `${row.current} ms`
          : row.current
    const base =
      row.unit === "bytes"
        ? row.baseline != null
          ? fmtKb(row.baseline)
          : "—"
        : row.unit === "ms"
          ? row.baseline != null
            ? `${row.baseline} ms`
            : "—"
          : (row.baseline ?? "—")
    const delta =
      row.unit === "bytes" && row.delta != null
        ? `${row.delta >= 0 ? "+" : "−"}${fmtKb(Math.abs(row.delta))}`
        : row.unit === "ms" && row.delta != null
          ? `${row.delta >= 0 ? "+" : "−"}${Math.abs(row.delta)} ms`
          : row.deltaPct != null
            ? fmtPct(1 + row.deltaPct)
            : ""
    lines.push(
      `  ${icon[row.status] ?? "?"} ${label.padEnd(42)} ${String(base).padStart(10)} → ${String(cur).padStart(10)}  ${delta}`,
    )
  }
  lines.push("")
  if (result.failures.length === 0) {
    lines.push("Result: PASS — no regressions beyond threshold, no budget breaches.")
  } else {
    lines.push(`Result: FAIL — ${result.failures.length} issue(s):`)
    for (const failure of result.failures) lines.push(`  ✗ ${failure}`)
  }
  for (const warning of result.warnings) lines.push(`  ! ${warning}`)
  return lines.join("\n")
}

// ---------------------------------------------------------------------------
// snapshot persistence
// ---------------------------------------------------------------------------

export function snapshotFileName(name, snapshot) {
  const safe = name.replace(/[^a-zA-Z0-9._-]+/g, "-")
  const stamp = (snapshot.capturedAt ?? new Date().toISOString()).replace(/[:.]/g, "-")
  return `${stamp}-${safe}.json`
}

export function writeSnapshot(snapshot, dir, name) {
  mkdirSync(dir, { recursive: true })
  const fileName = name
    ? `${name.replace(/[^a-zA-Z0-9._-]+/g, "-")}.json`
    : snapshotFileName("snapshot", snapshot)
  const path = join(dir, fileName)
  writeFileSync(path, JSON.stringify(snapshot, null, 2) + "\n")
  return path
}

export function latestBaseline(name = "main") {
  const path = join(BASELINES_DIR, `${name}.json`)
  if (!existsSync(path)) {
    const candidates = existsSync(BASELINES_DIR)
      ? readdirSync(BASELINES_DIR).filter((f) => f.endsWith(".json") && f.includes(name))
      : []
    if (candidates.length === 0) {
      throw new Error(
        `No baseline named "${name}" in ${BASELINES_DIR}. ` +
          "Capture one with `node scripts/perf/benchmarks/compare.mjs baseline`.",
      )
    }
    return join(BASELINES_DIR, candidates.sort().at(-1))
  }
  return path
}

export function summarizeSnapshot(snapshot) {
  const top = (snapshot.routes ?? []).slice(0, 5)
  return {
    source: snapshot.source,
    buildId: snapshot.buildId,
    totals: snapshot.totals,
    routeCount: (snapshot.routes ?? []).length,
    topRoutes: top.map((r) => ({ route: r.route, jsKb: Math.round(kb(r.jsBytes)) })),
    runtime: snapshot.runtime,
  }
}
