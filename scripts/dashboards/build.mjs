#!/usr/bin/env node
/**
 * Static dashboard generator for Spindle's operational JSON reports.
 *
 * Reads (or generates, in --demo mode) the JSON outputs of the existing
 * reporting scripts and renders one self-contained HTML dashboard with
 * inline CSS/SVG — no CDN, no build step, safe to archive or serve statically.
 *
 * Sources:
 *   deploy metrics   scripts/deploy/metrics/collect.mjs   (metrics.json)
 *   SLO/error budget scripts/slo/report.mjs --json        (report JSON)
 *                    scripts/sre/errorbudget/budget.mjs --json (report JSON)
 *   logs/metrics     scripts/metrics/log-metrics.mjs --format json
 *   finops           scripts/finops/report.mjs            (report JSON)
 *
 * Usage:
 *   node scripts/dashboards/build.mjs --demo --out docs/dashboards/site
 *   node scripts/dashboards/build.mjs --data-dir reports/ --out site/
 *
 * Options:
 *   --demo             run each source script in its offline demo mode and
 *                      collect their JSON output (default when --data-dir
 *                      is not given)
 *   --data-dir <dir>   read pre-generated JSON files instead of running the
 *                      scripts. Expected filenames:
 *                        deploy-metrics.json  (or metrics.json)
 *                        slo-report.json
 *                        error-budget.json
 *                        log-metrics.json
 *                        finops-report.json  (or newest finops-report-*.json)
 *                      A dashboard-data.json from a previous build is also
 *                      accepted and supplies all sections at once.
 *   --out <dir>        output directory (default scripts/dashboards/.output)
 *   --help, -h         show this message
 *
 * Outputs:
 *   index.html         self-contained dashboard
 *   dashboard-data.json  normalized dataset embedded in the HTML (for reuse)
 *
 * Exit codes: 0 ok (missing sources render an empty section), 2 usage error.
 */

import { execFileSync, spawnSync } from "node:child_process"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, "../..")
const DEFAULT_OUT = join(HERE, ".output")

const HELP = `Usage: node scripts/dashboards/build.mjs [options]

Options:
  --demo             collect JSON by running each source script in --demo
                     mode (default when --data-dir is absent)
  --data-dir <dir>   read pre-generated JSON reports instead of running
                     scripts (see header comment for expected filenames)
  --out <dir>        output directory (default ${DEFAULT_OUT})
  --help, -h         show this message

Exit codes: 0 ok, 2 usage error.`

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const options = { demo: false, dataDir: null, out: DEFAULT_OUT, help: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    switch (arg) {
      case "--demo":
        options.demo = true
        break
      case "--data-dir":
        options.dataDir = argv[++i]
        if (!options.dataDir) throw new Error("--data-dir requires a value")
        break
      case "--out":
        options.out = argv[++i]
        if (!options.out) throw new Error("--out requires a value")
        break
      case "--help":
      case "-h":
        options.help = true
        break
      default:
        throw new Error(`unknown option: ${arg}`)
    }
  }
  if (!options.dataDir) options.demo = true
  return options
}

// ---------------------------------------------------------------------------
// Source collection
// ---------------------------------------------------------------------------

function runJson(argv) {
  // spawnSync (not execFileSync) so scripts like slo/report.mjs may exit 1
  // on an SLO breach while still printing a valid JSON report.
  const res = spawnSync(process.execPath, argv, {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
  const stdout = res.stdout ?? ""
  const start = stdout.indexOf("{")
  const end = stdout.lastIndexOf("}")
  if (start === -1 || end <= start) {
    const why = res.error ? res.error.message : `exit ${res.status}`
    throw new Error(`${argv.join(" ")} produced no JSON (${why})`)
  }
  try {
    return JSON.parse(stdout.slice(start, end + 1))
  } catch (err) {
    throw new Error(`${argv.join(" ")} produced invalid JSON: ${err.message}`, { cause: err })
  }
}

function collectDemo() {
  const work = mkdtempSync(join(tmpdir(), "spindle-dashboards-"))
  const data = {}

  // Deploy metrics — writes files, then read metrics.json.
  const dmDir = join(work, "deploy")
  try {
    execFileSync(
      process.execPath,
      ["scripts/deploy/metrics/collect.mjs", "--demo", "--out", dmDir],
      { cwd: ROOT, stdio: "pipe" },
    )
    const file = join(dmDir, "metrics.json")
    if (existsSync(file)) data.deployMetrics = JSON.parse(readFileSync(file, "utf8"))
  } catch {
    /* section renders empty */
  }

  // SLO report — pure JSON on stdout.
  try {
    data.slo = runJson(["scripts/slo/report.mjs", "--demo", "--json", "--window", "day,7d,28d"])
  } catch {
    /* section renders empty */
  }

  // Error budget — pure JSON on stdout.
  try {
    data.errorBudget = runJson(["scripts/sre/errorbudget/budget.mjs", "--demo", "--json"])
  } catch {
    /* section renders empty */
  }

  // Log metrics — pure JSON on stdout.
  try {
    data.logMetrics = runJson(["scripts/metrics/log-metrics.mjs", "--demo", "--format", "json"])
  } catch {
    /* section renders empty */
  }

  // FinOps — writes report files; read the newest one.
  const finDir = join(work, "finops")
  try {
    execFileSync(
      process.execPath,
      ["scripts/finops/report.mjs", "--demo", "--json", "--out", finDir],
      { cwd: ROOT, stdio: "pipe" },
    )
    const files = readdirSync(finDir)
      .filter((f) => f.endsWith(".json"))
      .sort()
    const file = files[files.length - 1]
    if (file) data.finops = JSON.parse(readFileSync(join(finDir, file), "utf8"))
  } catch {
    /* section renders empty */
  }

  return data
}

const DATA_FILES = {
  deployMetrics: ["deploy-metrics.json", "metrics.json"],
  slo: ["slo-report.json"],
  errorBudget: ["error-budget.json"],
  logMetrics: ["log-metrics.json"],
}

/**
 * finops/report.mjs --out writes dated files
 * (finops-report-YYYY-MM-DD[-demo].json), so when the literal filename is
 * absent fall back to the newest matching report in the directory.
 */
function finopsReportFile(dir) {
  const literal = join(dir, "finops-report.json")
  if (existsSync(literal)) return literal
  let newest = null
  try {
    for (const name of readdirSync(dir)) {
      if (!/^finops-report-.+\.json$/.test(name)) continue
      if (!newest || name.localeCompare(newest, undefined, { numeric: true }) > 0) newest = name
    }
  } catch {
    /* unreadable dir -> empty section */
  }
  return newest ? join(dir, newest) : null
}

function collectDataDir(dir) {
  const data = {}
  // A previous build's dashboard-data.json carries every section at once.
  const bundle = join(dir, "dashboard-data.json")
  if (existsSync(bundle)) {
    try {
      const parsed = JSON.parse(readFileSync(bundle, "utf8"))
      if (parsed?.data && typeof parsed.data === "object") {
        Object.assign(data, parsed.data)
      }
    } catch {
      /* fall through to per-file lookup */
    }
  }
  for (const [key, names] of Object.entries(DATA_FILES)) {
    for (const name of names) {
      const file = join(dir, name)
      if (existsSync(file)) {
        try {
          data[key] = JSON.parse(readFileSync(file, "utf8"))
        } catch {
          /* malformed file -> empty section */
        }
        break
      }
    }
  }
  // finops/report.mjs --out writes dated filenames; accept them too.
  const finopsFile = finopsReportFile(dir)
  if (finopsFile) {
    try {
      data.finops = JSON.parse(readFileSync(finopsFile, "utf8"))
    } catch {
      /* malformed file -> empty section */
    }
  }
  return data
}

// ---------------------------------------------------------------------------
// HTML rendering helpers
// ---------------------------------------------------------------------------

const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  )

const fmtNum = (n, digits = 0) =>
  Number.isFinite(n) ? n.toLocaleString("en-US", { maximumFractionDigits: digits }) : "n/a"
const fmtUsd = (n) => (Number.isFinite(n) ? `$${n.toFixed(2)}` : "n/a")
const fmtPct = (n, digits = 1) => (Number.isFinite(n) ? `${(n * 100).toFixed(digits)}%` : "n/a")
const fmtMs = (n) =>
  n == null ? "n/a" : n >= 1000 ? `${(n / 1000).toFixed(2)}s` : `${Math.round(n)}ms`

function kpi(label, value, hint = "") {
  return `<div class="kpi"><div class="kpi-label">${esc(label)}</div><div class="kpi-value">${esc(value)}</div>${hint ? `<div class="kpi-hint">${esc(hint)}</div>` : ""}</div>`
}

function statusBadge(status) {
  const cls =
    status === "ok" || status === "success"
      ? "ok"
      : status === "breach" || status === "failure" || status === "deploy-halt"
        ? "bad"
        : status === "warning" ||
            status === "watch" ||
            status === "rolled-back" ||
            status === "approval-required" ||
            status === "incident-review"
          ? "warn"
          : "muted"
  return `<span class="badge ${cls}">${esc(status)}</span>`
}

function table(headers, rows) {
  const head = headers.map((h) => `<th>${esc(h)}</th>`).join("")
  const body = rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")
  return `<table><thead><tr>${head}</tr></thead><tbody>${body || `<tr><td colspan="${headers.length}" class="empty">no data</td></tr>`}</tbody></table>`
}

/** Horizontal bar chart rendered as pure SVG. items: [{label, value, color?}] */
function barChart(items, { width = 640, rowH = 22, max = null } = {}) {
  if (!items.length) return `<p class="empty">no data</p>`
  const top = Math.max(...items.map((i) => i.value), max ?? 0, 1e-9)
  const labelW = 190
  const barW = width - labelW - 60
  const h = items.length * rowH + 8
  const bars = items
    .map((it, idx) => {
      const y = idx * rowH + 4
      const w = Math.max(1, (it.value / top) * barW)
      const color = it.color ?? "#4f8ef7"
      return `<text x="${labelW - 8}" y="${y + 14}" text-anchor="end" class="svg-label">${esc(it.label)}</text>
<rect x="${labelW}" y="${y}" width="${w.toFixed(1)}" height="${rowH - 8}" rx="2" fill="${color}"/>
<text x="${labelW + w + 6}" y="${y + 14}" class="svg-value">${esc(it.display ?? fmtNum(it.value))}</text>`
    })
    .join("\n")
  return `<svg viewBox="0 0 ${width} ${h}" width="100%" role="img">${bars}</svg>`
}

/** Grouped vertical bar chart. groups: [{label, series:[{name,value,color}]}] */
function groupedBars(groups, { width = 720, height = 220 } = {}) {
  if (!groups.length) return `<p class="empty">no data</p>`
  const seriesNames = [...new Set(groups.flatMap((g) => g.series.map((s) => s.name)))]
  const colors = ["#4f8ef7", "#e5534b", "#3fb950", "#d29922"]
  const top = Math.max(...groups.flatMap((g) => g.series.map((s) => s.value)), 1e-9)
  const padL = 44
  const padB = 28
  const padT = 10
  const plotW = width - padL - 10
  const plotH = height - padT - padB
  const groupW = plotW / groups.length
  const barW = Math.min(28, (groupW * 0.7) / seriesNames.length)
  let svg = ""
  // y gridlines
  for (let i = 0; i <= 4; i++) {
    const y = padT + plotH - (plotH * i) / 4
    const val = (top * i) / 4
    svg += `<line x1="${padL}" y1="${y}" x2="${width - 10}" y2="${y}" class="svg-grid"/>
<text x="${padL - 6}" y="${y + 4}" text-anchor="end" class="svg-tick">${esc(fmtNum(val))}</text>`
  }
  groups.forEach((g, gi) => {
    const gx = padL + gi * groupW + groupW / 2
    g.series.forEach((s, si) => {
      const h = (s.value / top) * plotH
      const x = gx - (g.series.length * barW) / 2 + si * barW
      const color = s.color ?? colors[si % colors.length]
      svg += `<rect x="${x.toFixed(1)}" y="${(padT + plotH - h).toFixed(1)}" width="${(barW - 2).toFixed(1)}" height="${h.toFixed(1)}" rx="2" fill="${color}"/>`
    })
    svg += `<text x="${gx}" y="${height - 8}" text-anchor="middle" class="svg-tick">${esc(g.label)}</text>`
  })
  const legend = seriesNames
    .map(
      (n, i) =>
        `<span class="legend"><i style="background:${colors[i % colors.length]}"></i>${esc(n)}</span>`,
    )
    .join("")
  return `<svg viewBox="0 0 ${width} ${height}" width="100%" role="img">${svg}</svg><div class="legend-row">${legend}</div>`
}

/** Simple polyline chart for time series. points: [{x:label, y:number, ok?}] */
function lineChart(points, { width = 720, height = 180, color = "#4f8ef7" } = {}) {
  if (!points.length) return `<p class="empty">no data</p>`
  const vals = points.map((p) => p.y).filter(Number.isFinite)
  if (!vals.length) return `<p class="empty">no data</p>`
  const min = Math.min(...vals)
  const max = Math.max(...vals)
  const span = max - min || 1
  const padL = 44
  const padB = 24
  const padT = 10
  const plotW = width - padL - 10
  const plotH = height - padT - padB
  const x = (i) => padL + (points.length === 1 ? plotW / 2 : (i / (points.length - 1)) * plotW)
  const y = (v) => padT + plotH - ((v - min) / span) * plotH
  const coords = points
    .map((p, i) => (Number.isFinite(p.y) ? `${x(i).toFixed(1)},${y(p.y).toFixed(1)}` : null))
    .filter(Boolean)
    .join(" ")
  let svg = ""
  for (let i = 0; i <= 4; i++) {
    const gy = padT + plotH - (plotH * i) / 4
    const val = min + (span * i) / 4
    svg += `<line x1="${padL}" y1="${gy}" x2="${width - 10}" y2="${gy}" class="svg-grid"/>
<text x="${padL - 6}" y="${gy + 4}" text-anchor="end" class="svg-tick">${esc(fmtNum(val))}</text>`
  }
  svg += `<polyline points="${coords}" fill="none" stroke="${color}" stroke-width="1.5"/>`
  if (points.length <= 40) {
    points.forEach((p, i) => {
      if (!Number.isFinite(p.y)) return
      const bad = p.ok === false
      svg += `<circle cx="${x(i).toFixed(1)}" cy="${y(p.y).toFixed(1)}" r="2.5" fill="${bad ? "#e5534b" : color}"/>`
    })
  }
  const first = points[0]?.x
  const last = points[points.length - 1]?.x
  svg += `<text x="${padL}" y="${height - 6}" class="svg-tick">${esc(first ?? "")}</text>
<text x="${width - 10}" y="${height - 6}" text-anchor="end" class="svg-tick">${esc(last ?? "")}</text>`
  return `<svg viewBox="0 0 ${width} ${height}" width="100%" role="img">${svg}</svg>`
}

// ---------------------------------------------------------------------------
// Section renderers — each tolerates a missing/partial payload.
// ---------------------------------------------------------------------------

function renderDeployMetrics(d) {
  if (!d)
    return `<section class="card"><h2>Deploy metrics</h2><p class="empty">no data — run collect.mjs or pass --data-dir</p></section>`
  const rel = Array.isArray(d.releases) ? d.releases : []
  const s = d.summary ?? {}
  const health = s.health ?? {}
  const releasesAsc = [...rel].reverse() // oldest -> newest for charts
  const buildChart = groupedBars(
    releasesAsc.map((r) => ({
      label: String(r.version ?? r.release ?? "?"),
      series: [{ name: "build s", value: Number(r.buildSeconds) || 0 }],
    })),
  )
  const deployChart = groupedBars(
    releasesAsc.map((r) => ({
      label: String(r.version ?? r.release ?? "?"),
      series: [
        {
          name: "deploy s",
          value: Number(r.deploySeconds) || 0,
          color: r.rollback || r.status === "rolled-back" ? "#d29922" : "#3fb950",
        },
      ],
    })),
  )
  const healthPts = (Array.isArray(d.healthSamples) ? d.healthSamples : []).map((p) => ({
    x: p.timestamp,
    y: Number(p.latencyMs) || 0,
    ok: p.ok !== false,
  }))
  const rows = rel.map((r) => [
    esc(r.version ?? r.release ?? "?"),
    `<code>${esc(String(r.commit ?? "").slice(0, 8))}</code>`,
    esc(r.timestamp ? new Date(r.timestamp).toISOString().slice(0, 16).replace("T", " ") : ""),
    fmtNum(r.buildSeconds, 1),
    fmtNum(r.deploySeconds, 1),
    fmtNum(r.rollbackCount ?? (r.rollback ? 1 : 0)),
    statusBadge(r.status ?? (r.rollback ? "rolled-back" : "success")),
  ])
  return `<section class="card">
<h2>Deploy metrics <span class="muted">${esc(d.mode ?? "")} · generated ${esc(d.generatedAt ?? "")}</span></h2>
<div class="kpis">
${kpi("releases", fmtNum(s.releaseCount ?? rel.length))}
${kpi("rollbacks", fmtNum(s.rollbackCount), "revert/rollback commits")}
${kpi("failures", fmtNum(s.failureCount))}
${kpi("current version", s.currentVersion ?? "n/a")}
${kpi("avg build", s.avgBuildSeconds != null ? `${fmtNum(s.avgBuildSeconds, 1)}s` : "n/a")}
${kpi("avg deploy", s.avgDeploySeconds != null ? `${fmtNum(s.avgDeploySeconds, 1)}s` : "n/a")}
${kpi("health latency", health.avgLatencyMs != null ? `${fmtNum(health.avgLatencyMs, 0)}ms` : "n/a", health.samples != null ? `${health.samples} samples` : "")}
</div>
<div class="grid2">
<div><h3>Build time per release (s)</h3>${buildChart}</div>
<div><h3>Deploy duration per release (s, rollbacks in amber)</h3>${deployChart}</div>
</div>
<h3>Health-check latency</h3>${lineChart(healthPts, { color: "#58a6ff" })}
<h3>Releases</h3>${table(["version", "commit", "timestamp", "build s", "deploy s", "rollbacks", "status"], rows)}
</section>`
}

function renderSlo(d) {
  if (!d)
    return `<section class="card"><h2>SLO &amp; error budget</h2><p class="empty">no data — run scripts/slo/report.mjs --demo --json</p></section>`
  const slos = Array.isArray(d.slos) ? d.slos : []
  const windows = Array.isArray(d.windows) ? d.windows : []
  const parts = []
  for (const w of windows) {
    const services = w.services ?? {}
    const rows = Object.entries(services).map(([id, s]) => [
      esc(id),
      esc(sloTitle(d, id)),
      s.samples ?? "-",
      fmtPct(s.attainment, 3),
      statusBadge(s.status),
      s.budgetRemainingPct != null ? `${fmtNum(s.budgetRemainingPct, 1)}%` : "n/a",
      fmtMs(s.observed?.p50Ms),
      fmtMs(s.observed?.p95Ms),
      fmtMs(s.observed?.p99Ms),
      s.latencyNote ? `<span class="muted">${esc(s.latencyNote)}</span>` : "",
    ])
    parts.push(`<h3>Window: ${esc(w.window)}${w.days ? ` (last ${w.days}d)` : " (all data)"} — ${fmtNum(w.samples)} samples</h3>
${table(["service", "title", "samples", "SLI attainment", "status", "budget left", "p50", "p95", "p99", "notes"], rows)}`)
  }
  const targetRows = slos.map((s) => [
    esc(s.id),
    esc(s.title),
    `${(s.availabilityTarget * 100).toFixed(2)}%`,
    `${fmtNum(s.errorBudgetPct, 3)}%`,
    s.latency ? `p95 ≤ ${fmtMs(s.latency.p95Ms)}, p99 ≤ ${fmtMs(s.latency.p99Ms)}` : "—",
  ])
  return `<section class="card">
<h2>SLO attainment &amp; error budget <span class="muted">evaluated ${esc(d.evaluationInstant ?? "")} · generated ${esc(d.generatedAt ?? "")}</span></h2>
<h3>SLO targets</h3>
${table(["service", "title", "availability target", "error budget", "latency budgets"], targetRows)}
${parts.join("") || `<p class="empty">no windows</p>`}
</section>`
}

function sloTitle(report, id) {
  const s = (report.slos ?? []).find((x) => x.id === id)
  return s?.title ?? ""
}

function renderErrorBudget(d) {
  if (!d)
    return `<section class="card"><h2>Error budget (burn rate)</h2><p class="empty">no data — run scripts/sre/errorbudget/budget.mjs --demo --json</p></section>`
  const results = Array.isArray(d.results) ? d.results : []
  const rows = results.map((r) => [
    esc(r.window),
    `${fmtNum(r.target, 2)}%`,
    fmtNum(r.samples),
    fmtNum(r.badEvents),
    fmtPct(r.errorRatio, 3),
    `${fmtNum(r.budgetConsumedPct, 1)}%`,
    `${fmtNum(r.budgetRemainingPct, 1)}%`,
    `${fmtNum(r.burnRate, 2)}x`,
    esc(r.projectedExhaustion ?? "n/a"),
    statusBadge(r.policy),
    `<span class="muted">${esc(r.policyDescription ?? "")}</span>`,
  ])
  const budgetBars = results.map((r) => ({
    label: r.window,
    value: Math.max(0, r.budgetRemainingPct ?? 0),
    display: `${fmtNum(r.budgetRemainingPct, 1)}% left`,
    color:
      (r.budgetRemainingPct ?? 0) < 25
        ? "#e5534b"
        : (r.budgetRemainingPct ?? 0) < 50
          ? "#d29922"
          : "#3fb950",
  }))
  return `<section class="card">
<h2>Error budget &amp; burn rate <span class="muted">service ${esc(d.service ?? "")} · ${esc(d.demo ? "demo" : "live")}</span></h2>
${barChart(budgetBars, { width: 640 })}
${table(["window", "target", "samples", "bad events", "error ratio", "budget consumed", "budget remaining", "burn rate", "projected exhaustion", "policy", "description"], rows)}
</section>`
}

function renderLogMetrics(d) {
  if (!d)
    return `<section class="card"><h2>Logs &amp; request metrics</h2><p class="empty">no data — run scripts/metrics/log-metrics.mjs --demo --format json</p></section>`
  const s = d.summary ?? {}
  const req = s.requests ?? {}
  const lat = s.latencyMs ?? {}
  const win = s.window ?? {}
  const endpoints = Array.isArray(s.endpoints) ? s.endpoints : []
  const errMsgs = Array.isArray(s.topErrorMessages) ? s.topErrorMessages : []
  const rows = endpoints.map((e) => [
    `${esc(e.method)} ${esc(e.path)}`,
    e.status,
    fmtNum(e.count),
    fmtPct(e.errorRate, 2),
    fmtMs(e.avgDurationMs),
    fmtMs(e.p95DurationMs),
  ])
  const statusRows = Object.entries(s.errorsByStatus ?? {}).map(([st, n]) => [esc(st), fmtNum(n)])
  const msgRows = errMsgs.slice(0, 10).map((m) => [esc(m.message), fmtNum(m.count)])
  const routeRows = Object.entries(s.errorsByRoute ?? {}).map(([r, n]) => [esc(r), fmtNum(n)])
  return `<section class="card">
<h2>Logs &amp; request metrics <span class="muted">window ${esc(win.first ?? "")} → ${esc(win.last ?? "")} (${fmtNum(win.seconds, 0)}s)</span></h2>
<div class="kpis">
${kpi("requests", fmtNum(req.total))}
${kpi("errors", fmtNum(req.errors), fmtPct(req.errorRate, 2) + " error rate")}
${kpi("req/s", req.perSecond != null ? fmtNum(req.perSecond, 2) : "n/a")}
${kpi("p50 latency", fmtMs(lat.p50))}
${kpi("p95 latency", fmtMs(lat.p95))}
${kpi("p99 latency", fmtMs(lat.p99))}
</div>
<div class="grid2">
<div><h3>Errors by status</h3>${table(["status", "count"], statusRows)}</div>
<div><h3>Errors by route</h3>${table(["route", "count"], routeRows)}</div>
</div>
<h3>Top error messages</h3>${table(["message", "count"], msgRows)}
<h3>Per-endpoint</h3>${table(["endpoint", "status", "count", "error rate", "avg", "p95"], rows)}
</section>`
}

function renderFinops(d) {
  if (!d)
    return `<section class="card"><h2>FinOps cost report</h2><p class="empty">no data — run scripts/finops/report.mjs --demo</p></section>`
  const c = d.cost ?? {}
  const st = d.storage ?? {}
  const secs = d.sections ?? {}
  const compute = secs.compute ?? null
  const llm = secs.llm ?? {}
  const disk = secs.disk ?? {}
  const costRows = [
    ["Hetzner hosts (prod + staging)", fmtUsd(c.hostMonthlyUsd), "fixed"],
    ["Cloudflare Pro", fmtUsd(c.cloudflareProUsd), "plan"],
    ["Sentry", fmtUsd(c.sentryUsd), "org cap"],
    ["Resend", "$0.00", "beta quota"],
    [
      "B2 off-box backups",
      c.b2StorageUsd == null ? "not measured" : fmtUsd(c.b2StorageUsd),
      `${st.projectedB2Tb != null ? fmtNum(st.projectedB2Tb, 2) : "?"} TB projected at $6/TB`,
    ],
    [
      "LLM API",
      c.llmUsd == null ? "n/a" : fmtUsd(c.llmUsd),
      llm.costSource ?? llm.status ?? "not measured",
    ],
    [
      "<strong>Estimated total</strong>",
      `<strong>${fmtUsd(c.estimatedMonthlyUsd)}</strong>`,
      `beta range $${(c.betaEstimateRangeUsd ?? [155, 185]).join("–")}/mo`,
    ],
  ]
  const diskRows = (disk.entries ?? []).map((e) => [
    esc(e.label) + (e.truncated ? " (truncated scan)" : ""),
    fmtBytes(e.bytes),
  ])
  const containerRows = (secs.docker?.containers ?? []).map((ct) => [
    esc(ct.name),
    fmtNum(ct.cpuPercent, 1),
    esc(ct.memUsage ?? ""),
    fmtPct(ct.memPercent, 1),
  ])
  const recs = (d.recommendations ?? []).map(
    (r) =>
      `<li><span class="badge ${r.severity === "warn" ? "warn" : "muted"}">${esc(r.severity)}</span> ${esc(r.text)}</li>`,
  )
  return `<section class="card">
<h2>FinOps cost report <span class="muted">${esc(d.host ?? "")} · ${esc(d.mode ?? "")} · generated ${esc(d.generatedAt ?? "")}</span></h2>
<p class="muted">${esc(d.priceTable ?? "")}</p>
<h3>Monthly cost estimate (USD)</h3>
${table(["component", "USD/mo", "basis"], costRows)}
<div class="grid2">
<div><h3>Compute</h3>
${compute ? `<p class="muted">${fmtNum(compute.containerCount)} containers · ${fmtNum(compute.totalCpuPercent, 1)}% CPU · ${fmtNum(compute.totalMemUsedGb, 1)} GB / ${fmtNum(compute.hostRamGb, 0)} GB RAM (${fmtPct(compute.hostMemUtilizationPct / 100, 1)})</p>` : `<p class="empty">unavailable</p>`}
${table(["container", "CPU %", "memory", "mem %"], containerRows)}
</div>
<div><h3>Storage</h3>
${table(["path", "size"], diskRows)}
<p class="muted">Backups retained: ${fmtNum(st.backupRetentionCount)} artifacts · docker logs ${fmtBytes(st.dockerLogBytes)} of ${fmtBytes(st.dockerLogCapBytes)} cap</p>
<h3>LLM usage</h3>
${llm.status === "ok" || llm.status === "demo" ? `<p>${fmtNum(llm.requests)} requests · ${fmtNum(llm.inputTokens)} in / ${fmtNum(llm.outputTokens)} out tokens · ${fmtUsd(llm.costUsd)}</p>` : `<p class="empty">unavailable${llm.reason ? `: ${esc(llm.reason)}` : ""}</p>`}
</div>
</div>
<h3>Recommendations</h3>
${recs.length ? `<ul>${recs.join("")}</ul>` : `<p class="empty">none</p>`}
</section>`
}

function fmtBytes(bytes) {
  if (!Number.isFinite(bytes)) return "n/a"
  const gb = bytes / 1024 ** 3
  if (gb >= 1) return `${gb >= 10 ? gb.toFixed(1) : gb.toFixed(2)} GB`
  const mb = bytes / 1024 ** 2
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`
}

// ---------------------------------------------------------------------------
// Page shell
// ---------------------------------------------------------------------------

function renderPage(data, meta) {
  const sections = [
    renderDeployMetrics(data.deployMetrics),
    renderSlo(data.slo),
    renderErrorBudget(data.errorBudget),
    renderLogMetrics(data.logMetrics),
    renderFinops(data.finops),
  ]
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Spindle Dashboards</title>
<style>
:root { color-scheme: light dark; }
body { font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; margin: 0; padding: 24px; background: #0d1117; color: #e6edf3; }
.wrap { max-width: 1100px; margin: 0 auto; }
h1 { font-size: 22px; margin: 0 0 4px; }
h2 { font-size: 17px; margin: 0 0 12px; }
h3 { font-size: 14px; margin: 18px 0 8px; color: #9da7b3; text-transform: uppercase; letter-spacing: .04em; }
.muted { color: #8b949e; font-weight: 400; font-size: 12px; }
.card { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 16px 18px; margin: 16px 0; }
.kpis { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 8px; }
.kpi { background: #0d1117; border: 1px solid #30363d; border-radius: 6px; padding: 8px 14px; min-width: 110px; }
.kpi-label { font-size: 11px; color: #8b949e; text-transform: uppercase; letter-spacing: .04em; }
.kpi-value { font-size: 18px; font-weight: 600; margin-top: 2px; }
.kpi-hint { font-size: 11px; color: #8b949e; }
table { border-collapse: collapse; width: 100%; font-size: 13px; }
th, td { text-align: left; padding: 5px 8px; border-bottom: 1px solid #21262d; vertical-align: top; }
th { color: #8b949e; font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; }
td code { font-size: 12px; color: #79c0ff; }
.badge { display: inline-block; padding: 1px 8px; border-radius: 10px; font-size: 11px; font-weight: 600; border: 1px solid #30363d; }
.badge.ok { color: #3fb950; border-color: #3fb95055; background: #3fb95014; }
.badge.warn { color: #d29922; border-color: #d2992255; background: #d2992214; }
.badge.bad { color: #e5534b; border-color: #e5534b55; background: #e5534b14; }
.badge.muted { color: #8b949e; }
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
@media (max-width: 800px) { .grid2 { grid-template-columns: 1fr; } }
svg text { font-family: inherit; }
.svg-label { font-size: 11px; fill: #8b949e; }
.svg-value { font-size: 11px; fill: #c9d1d9; }
.svg-tick { font-size: 10px; fill: #8b949e; }
.svg-grid { stroke: #21262d; stroke-width: 1; }
.legend-row { margin-top: 4px; }
.legend { font-size: 11px; color: #8b949e; margin-right: 12px; }
.legend i { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 4px; }
.empty { color: #8b949e; font-style: italic; }
ul { padding-left: 20px; }
footer { color: #6e7681; font-size: 12px; margin: 24px 0; }
</style>
</head>
<body>
<div class="wrap">
<h1>Spindle Dashboards</h1>
<p class="muted">${esc(meta.source)} · generated ${esc(meta.generatedAt)} · static export — no live data</p>
${sections.join("\n")}
<footer>Built by <code>scripts/dashboards/build.mjs</code>. See <code>docs/dashboards/README.md</code> for sources and refresh instructions. Grafana equivalents live in <code>infra/dashboards/grafana/</code>.</footer>
</div>
</body>
</html>
`
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

function main() {
  let options
  try {
    options = parseArgs(process.argv.slice(2))
  } catch (err) {
    console.error(`[dashboards] ${err.message}`)
    console.error(HELP)
    process.exit(2)
  }
  if (options.help) {
    console.log(HELP)
    return
  }

  const outDir = resolve(ROOT, options.out)
  let data
  let source
  if (options.dataDir) {
    data = collectDataDir(resolve(ROOT, options.dataDir))
    source = `data-dir ${options.dataDir}`
  } else {
    data = collectDemo()
    source = "demo mode (synthetic data from source scripts)"
  }

  const missing = [
    ["deployMetrics", "deploy metrics"],
    ["slo", "SLO report"],
    ["errorBudget", "error budget"],
    ["logMetrics", "log metrics"],
    ["finops", "finops"],
  ]
    .filter(([k]) => !data[k])
    .map(([, label]) => label)
  if (missing.length) {
    console.warn(`[dashboards] no data for: ${missing.join(", ")}`)
  }

  const generatedAt = new Date().toISOString()
  mkdirSync(outDir, { recursive: true })
  const html = renderPage(data, { source, generatedAt })
  writeFileSync(join(outDir, "index.html"), html)
  writeFileSync(
    join(outDir, "dashboard-data.json"),
    JSON.stringify({ generatedAt, source, data }, null, 2) + "\n",
  )
  console.log(
    `[dashboards] wrote ${join(outDir, "index.html")} and dashboard-data.json (${source})`,
  )
}

main()
