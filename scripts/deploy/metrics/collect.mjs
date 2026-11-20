#!/usr/bin/env node
/**
 * Deployment metrics dashboard generator.
 *
 * Collects deployment metrics from local sources and emits a self-contained
 * HTML dashboard (inline CSS/SVG, no external deps) plus a JSON report.
 *
 * Sources (all optional; missing sources degrade gracefully):
 *   - git log / git tags        → release versions, deploy events, rollbacks
 *   - CI artifact JSON files    → build time, deploy duration, deploy status
 *   - health endpoint           → latency sample (--health-url)
 *
 * Usage:
 *   node scripts/deploy/metrics/collect.mjs [options]
 *
 * Options:
 *   --demo                  Use embedded sample data instead of real sources
 *   --out <dir>             Output directory (default: deploy-metrics/)
 *   --artifacts <dir>       Directory scanned for deploy artifact JSON files
 *                           (default: .deploy-artifacts)
 *   --health-url <url>      Health endpoint to time (default: none)
 *   --repo <path>           Git repository path (default: cwd)
 *   --last <n>              Number of releases to chart (default: 20)
 *
 * Artifact file shape (any *.json under --artifacts, recursively):
 *   {
 *     "release": "v1.2.3",          // optional; falls back to git describe
 *     "version": "1.2.3",
 *     "commit": "abc1234",          // optional git SHA
 *     "buildSeconds": 123.4,        // optional build duration
 *     "deploySeconds": 45.6,        // optional deploy duration
 *     "status": "success",          // optional: success | failure | rolled-back
 *     "timestamp": "2025-01-01T00:00:00Z"  // optional ISO timestamp
 *   }
 */

import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"

const DEFAULT_OUT = "deploy-metrics"
const DEFAULT_ARTIFACTS = ".deploy-artifacts"
const DEFAULT_LAST = 20

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = {
    demo: false,
    out: DEFAULT_OUT,
    artifacts: DEFAULT_ARTIFACTS,
    healthUrl: null,
    repo: process.cwd(),
    last: DEFAULT_LAST,
  }
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    if (a === "--demo") args.demo = true
    else if (a === "--out") args.out = argv[++i]
    else if (a === "--artifacts") args.artifacts = argv[++i]
    else if (a === "--health-url") args.healthUrl = argv[++i]
    else if (a === "--repo") args.repo = argv[++i]
    else if (a === "--last") args.last = Math.max(1, Number.parseInt(argv[++i], 10) || DEFAULT_LAST)
    else if (a === "--help" || a === "-h") {
      console.log(
        "Usage: collect.mjs [--demo] [--out dir] [--artifacts dir] [--health-url url] [--repo path] [--last n]",
      )
      process.exit(0)
    } else {
      console.error(`Unknown argument: ${a}`)
      process.exit(2)
    }
  }
  return args
}

// ---------------------------------------------------------------------------
// Demo data
// ---------------------------------------------------------------------------

function demoData() {
  const releases = []
  const base = Date.now() - 30 * 24 * 60 * 60 * 1000
  const statuses = ["success", "success", "success", "failure", "rolled-back", "success"]
  for (let i = 0; i < 12; i += 1) {
    const version = `1.${i + 1}.0`
    const status = statuses[i % statuses.length]
    releases.push({
      version,
      release: `v${version}`,
      timestamp: new Date(base + i * 2.4 * 24 * 60 * 60 * 1000).toISOString(),
      buildSeconds: 180 + (i % 5) * 40 + Math.round(Math.random() * 15),
      deploySeconds: 40 + (i % 4) * 12 + Math.round(Math.random() * 8),
      status,
      rollback: status === "rolled-back",
    })
  }
  // Match collect mode: newest release first.
  releases.reverse()
  const healthSamples = []
  const hbase = Date.now() - 14 * 24 * 60 * 60 * 1000
  for (let i = 0; i < 28; i += 1) {
    healthSamples.push({
      timestamp: new Date(hbase + i * 12 * 60 * 60 * 1000).toISOString(),
      latencyMs: Math.round(85 + Math.sin(i / 3) * 30 + Math.random() * 25),
      ok: i % 23 !== 7,
    })
  }
  return {
    generatedAt: new Date().toISOString(),
    mode: "demo",
    releases,
    healthSamples,
    summary: summarize(releases, healthSamples),
  }
}

// ---------------------------------------------------------------------------
// Collectors
// ---------------------------------------------------------------------------

function git(repo, args) {
  try {
    return execFileSync("git", ["-C", repo, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 10_000,
    }).trim()
  } catch {
    return ""
  }
}

function collectFromGit(repo, last) {
  // for-each-ref gives tag name, creatordate, object sha, and (for annotated
  // tags) the peeled commit sha in one call.
  const tagsOut = git(repo, [
    "for-each-ref",
    "refs/tags",
    "--format=%(refname:short)|%(creatordate:iso-strict)|%(objectname)|%(*objectname)",
  ])
  const tagEntries = tagsOut
    ? tagsOut
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const [tag, iso, objectname, peeled] = line.split("|")
          return { tag, iso, commit: peeled || objectname }
        })
    : []

  // Rank commits by position in HEAD's topological history so releases are
  // ordered newest-first even when creatordates tie (same-second commits,
  // lightweight tags sharing a commit date, etc.).
  const history = git(repo, ["rev-list", "--topo-order", "HEAD"]).split("\n").filter(Boolean)
  const rank = new Map(history.map((sha, i) => [sha, i]))
  const UNKNOWN = Number.MAX_SAFE_INTEGER
  tagEntries.sort((a, b) => {
    const ra = rank.get(a.commit) ?? UNKNOWN
    const rb = rank.get(b.commit) ?? UNKNOWN
    if (ra !== rb) return ra - rb
    return (b.iso || "").localeCompare(a.iso || "")
  })

  // Current release: latest tag or commit describe.
  const describe = git(repo, ["describe", "--tags", "--always", "--dirty"])
  const currentVersion = describe || git(repo, ["rev-parse", "--short", "HEAD"]) || "unknown"

  const releases = []
  for (const { tag, iso, commit } of tagEntries.slice(0, last)) {
    const version = tag.replace(/^v/, "")
    // Count rollbacks: revert/rollback commits between this tag and the
    // nearest ancestor tag. `git describe` on the parent is robust to
    // creatordate ties that make the tag-list order unreliable.
    const prev = git(repo, ["describe", "--tags", "--abbrev=0", `${tag}^`])
    let rollbackCount = 0
    if (prev) {
      const log = git(repo, [
        "log",
        `${prev}..${tag}`,
        "--oneline",
        "--grep=revert\\|rollback",
        "-i",
      ])
      rollbackCount = log ? log.split("\n").filter(Boolean).length : 0
    }
    releases.push({
      version,
      release: tag,
      commit: commit ? commit.slice(0, 12) : null,
      timestamp: iso || null,
      status: "unknown",
      rollback: rollbackCount > 0,
      rollbackCount,
      buildSeconds: null,
      deploySeconds: null,
    })
  }

  // If there are no tags, emit a single entry for HEAD.
  if (releases.length === 0) {
    releases.push({
      version: currentVersion,
      release: currentVersion,
      commit: git(repo, ["rev-parse", "--short", "HEAD"]) || null,
      timestamp: null,
      status: "unknown",
      rollback: false,
      rollbackCount: 0,
      buildSeconds: null,
      deploySeconds: null,
    })
  }
  return { currentVersion, releases }
}

function walkJson(dir, out = []) {
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    let st
    try {
      st = statSync(p)
    } catch {
      continue
    }
    if (st.isDirectory()) walkJson(p, out)
    else if (st.isFile() && entry.endsWith(".json")) out.push(p)
  }
  return out
}

function collectFromArtifacts(dir, releases) {
  const files = walkJson(dir)
  let matched = 0
  for (const file of files) {
    let data
    try {
      data = JSON.parse(readFileSync(file, "utf8"))
    } catch {
      continue
    }
    const releaseKey = data.release || (data.version ? `v${data.version}` : null)
    // Artifact commits may be short (7 chars) or full (40 chars) SHAs while
    // git entries store a 12-char slice — match on prefix either way.
    const rel = releases.find((r) => {
      const commitMatch =
        r.commit &&
        typeof data.commit === "string" &&
        data.commit.length > 0 &&
        (r.commit.startsWith(data.commit) || data.commit.startsWith(r.commit))
      return r.release === releaseKey || r.version === data.version || commitMatch
    })
    if (!rel) continue
    matched += 1
    if (typeof data.buildSeconds === "number") rel.buildSeconds = data.buildSeconds
    if (typeof data.deploySeconds === "number") rel.deploySeconds = data.deploySeconds
    if (typeof data.status === "string") rel.status = data.status
    if (typeof data.rollback === "boolean") rel.rollback = data.rollback
    if (typeof data.rollbackCount === "number") rel.rollbackCount = data.rollbackCount
    if (data.timestamp) rel.timestamp = data.timestamp
    if (data.commit) rel.commit = data.commit
  }
  return { filesScanned: files.length, artifactsMatched: matched }
}

async function sampleHealth(url) {
  const samples = []
  for (let i = 0; i < 3; i += 1) {
    const start = performance.now()
    try {
      const timeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("health check timed out")), 10_000),
      )
      const res = await Promise.race([fetch(url), timeout])
      await res.arrayBuffer()
      samples.push({
        timestamp: new Date().toISOString(),
        latencyMs: Math.round(performance.now() - start),
        ok: res.ok,
        status: res.status,
      })
    } catch (err) {
      samples.push({
        timestamp: new Date().toISOString(),
        latencyMs: Math.round(performance.now() - start),
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }
  return samples
}

// ---------------------------------------------------------------------------
// Summary + HTML
// ---------------------------------------------------------------------------

function summarize(releases, healthSamples) {
  const buildTimes = releases.map((r) => r.buildSeconds).filter((v) => typeof v === "number")
  const deployTimes = releases.map((r) => r.deploySeconds).filter((v) => typeof v === "number")
  const latencies = healthSamples.map((s) => s.latencyMs).filter((v) => typeof v === "number")
  const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null)
  return {
    releaseCount: releases.length,
    rollbackCount: releases.reduce((n, r) => n + (r.rollbackCount || (r.rollback ? 1 : 0)), 0),
    failureCount: releases.filter((r) => r.status === "failure").length,
    avgBuildSeconds: avg(buildTimes),
    avgDeploySeconds: avg(deployTimes),
    currentVersion: releases[0]?.version ?? null,
    health: latencies.length
      ? {
          samples: latencies.length,
          avgLatencyMs: avg(latencies),
          maxLatencyMs: Math.max(...latencies),
          failures: healthSamples.filter((s) => !s.ok).length,
        }
      : null,
  }
}

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

function barChartSvg(title, items, unit, color = "#4f8ef7") {
  // items: [{label, value, sub}]
  const valid = items.filter((i) => typeof i.value === "number" && Number.isFinite(i.value))
  if (!valid.length) {
    return `<section class="card"><h2>${esc(title)}</h2><p class="empty">No data</p></section>`
  }
  const W = 720
  const rowH = 34
  const padL = 110
  const padR = 60
  const H = 48 + valid.length * rowH
  const max = Math.max(...valid.map((i) => i.value), 1)
  const bars = valid
    .map((it, idx) => {
      const y = 40 + idx * rowH
      const w = Math.max(2, ((W - padL - padR) * it.value) / max)
      const label = it.label.length > 14 ? `${it.label.slice(0, 13)}…` : it.label
      return (
        `<text x="${padL - 8}" y="${y + 16}" text-anchor="end" class="lbl">${esc(label)}</text>` +
        `<rect x="${padL}" y="${y}" width="${w.toFixed(1)}" height="${rowH - 12}" rx="3" fill="${color}"/>` +
        `<text x="${padL + w + 6}" y="${y + 16}" class="val">${esc(it.value)}${esc(unit)}${it.sub ? ` <tspan class="sub">${esc(it.sub)}</tspan>` : ""}</text>`
      )
    })
    .join("")
  return (
    `<section class="card"><h2>${esc(title)}</h2>` +
    `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}">${bars}</svg></section>`
  )
}

function lineChartSvg(title, points, yLabel, color = "#34c98e") {
  // points: [{t, value}]
  const valid = points.filter((p) => typeof p.value === "number" && Number.isFinite(p.value))
  if (valid.length < 2) {
    return `<section class="card"><h2>${esc(title)}</h2><p class="empty">No data</p></section>`
  }
  const W = 720
  const H = 200
  const padL = 46
  const padR = 14
  const padT = 18
  const padB = 28
  const vals = valid.map((p) => p.value)
  const min = Math.min(...vals)
  const max = Math.max(...vals)
  const span = max - min || 1
  const xs = valid.map((_, i) => padL + ((W - padL - padR) * i) / (valid.length - 1))
  const ys = valid.map((p) => padT + (H - padT - padB) * (1 - (p.value - min) / span))
  const path = valid
    .map((_, i) => `${i === 0 ? "M" : "L"}${xs[i].toFixed(1)},${ys[i].toFixed(1)}`)
    .join(" ")
  const first = valid[0].t ? new Date(valid[0].t) : null
  const last = valid[valid.length - 1].t ? new Date(valid[valid.length - 1].t) : null
  const fmt = (d) => (d ? d.toISOString().slice(0, 10) : "")
  return (
    `<section class="card"><h2>${esc(title)} <span class="muted">${esc(yLabel)}</span></h2>` +
    `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}">` +
    `<line x1="${padL}" y1="${H - padB}" x2="${W - padR}" y2="${H - padB}" class="axis"/>` +
    `<line x1="${padL}" y1="${padT}" x2="${padL}" y2="${H - padB}" class="axis"/>` +
    `<text x="${padL - 6}" y="${padT + 4}" class="val" text-anchor="end">${max.toFixed(0)}</text>` +
    `<text x="${padL - 6}" y="${H - padB}" class="val" text-anchor="end">${min.toFixed(0)}</text>` +
    `<path d="${path}" fill="none" stroke="${color}" stroke-width="2"/>` +
    valid
      .map(
        (p, i) =>
          `<circle cx="${xs[i].toFixed(1)}" cy="${ys[i].toFixed(1)}" r="2.5" fill="${color}"><title>${esc(p.t || "")} — ${p.value}</title></circle>`,
      )
      .join("") +
    `<text x="${padL}" y="${H - 8}" class="lbl">${esc(fmt(first))}</text>` +
    `<text x="${W - padR}" y="${H - 8}" class="lbl" text-anchor="end">${esc(fmt(last))}</text>` +
    `</svg></section>`
  )
}

function statusBadge(status) {
  const cls =
    status === "success"
      ? "ok"
      : status === "failure"
        ? "bad"
        : status === "rolled-back"
          ? "warn"
          : "unk"
  return `<span class="badge ${cls}">${esc(status)}</span>`
}

function renderHtml(data) {
  const { summary, releases, healthSamples } = data
  const fmtNum = (v, digits = 1) =>
    typeof v === "number" && Number.isFinite(v) ? v.toFixed(digits) : "—"

  const kpis = [
    ["Releases", summary.releaseCount],
    ["Rollbacks", summary.rollbackCount],
    ["Failures", summary.failureCount],
    ["Current version", summary.currentVersion || "—"],
    ["Avg build", summary.avgBuildSeconds == null ? "—" : `${fmtNum(summary.avgBuildSeconds, 0)}s`],
    [
      "Avg deploy",
      summary.avgDeploySeconds == null ? "—" : `${fmtNum(summary.avgDeploySeconds, 0)}s`,
    ],
    ["Health avg", summary.health ? `${fmtNum(summary.health.avgLatencyMs, 0)}ms` : "—"],
  ]
    .map(
      ([k, v]) =>
        `<div class="kpi"><div class="kpi-v">${esc(v)}</div><div class="kpi-k">${esc(k)}</div></div>`,
    )
    .join("")

  const buildItems = [...releases]
    .reverse()
    .map((r) => ({ label: r.version, value: r.buildSeconds, sub: r.status }))
  const deployItems = [...releases].reverse().map((r) => ({
    label: r.version,
    value: r.deploySeconds,
    sub: r.rollback || r.status === "rolled-back" ? "rollback" : r.status,
  }))

  const healthPoints = healthSamples.map((s) => ({ t: s.timestamp, value: s.latencyMs }))
  const healthFails = healthSamples.filter((s) => !s.ok).length

  const rows = releases
    .map(
      (r) => `<tr>
        <td>${esc(r.release || r.version)}</td>
        <td>${esc(r.commit || "—")}</td>
        <td>${esc((r.timestamp || "").slice(0, 19).replace("T", " ") || "—")}</td>
        <td>${r.buildSeconds == null ? "—" : `${fmtNum(r.buildSeconds, 0)}s`}</td>
        <td>${r.deploySeconds == null ? "—" : `${fmtNum(r.deploySeconds, 0)}s`}</td>
        <td>${r.rollbackCount ? `${r.rollbackCount}×` : "—"}</td>
        <td>${statusBadge(r.status)}</td>
      </tr>`,
    )
    .join("")

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Deploy Metrics — ${esc(data.mode === "demo" ? "Demo" : "Report")}</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
         margin: 0; padding: 24px; background: #0f1420; color: #e6e9f0; }
  h1 { font-size: 1.4rem; margin: 0 0 4px; }
  .muted { color: #8b93a7; font-weight: 400; font-size: .85em; }
  .sub { fill: #8b93a7; font-size: 10px; }
  .meta { color: #8b93a7; font-size: .85rem; margin-bottom: 20px; }
  .kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; margin-bottom: 20px; }
  .kpi { background: #171e2e; border: 1px solid #26314a; border-radius: 10px; padding: 14px 16px; }
  .kpi-v { font-size: 1.5rem; font-weight: 700; }
  .kpi-k { font-size: .78rem; color: #8b93a7; text-transform: uppercase; letter-spacing: .04em; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); gap: 16px; }
  .card { background: #171e2e; border: 1px solid #26314a; border-radius: 10px; padding: 16px; overflow-x: auto; }
  .card h2 { font-size: .95rem; margin: 0 0 10px; }
  svg { width: 100%; height: auto; display: block; }
  .lbl { fill: #aab2c5; font-size: 11px; }
  .val { fill: #dfe4f0; font-size: 11px; }
  .axis { stroke: #3a4560; stroke-width: 1; }
  .empty { color: #8b93a7; font-size: .9rem; }
  table { width: 100%; border-collapse: collapse; font-size: .85rem; }
  th, td { text-align: left; padding: 7px 10px; border-bottom: 1px solid #26314a; white-space: nowrap; }
  th { color: #8b93a7; font-weight: 600; font-size: .75rem; text-transform: uppercase; letter-spacing: .04em; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: .75rem; font-weight: 600; }
  .badge.ok { background: #123b2a; color: #4ade80; }
  .badge.bad { background: #3d1620; color: #f87171; }
  .badge.warn { background: #3d2f12; color: #fbbf24; }
  .badge.unk { background: #26314a; color: #aab2c5; }
  .banner { background: #3d2f12; border: 1px solid #6b5518; color: #fcd34d;
            border-radius: 10px; padding: 10px 14px; margin-bottom: 16px; font-size: .9rem; }
</style>
</head>
<body>
<h1>Deployment Metrics${data.mode === "demo" ? ' <span class="muted">— demo data</span>' : ""}</h1>
<div class="meta">Generated ${esc(data.generatedAt)}${data.collector ? ` · ${esc(data.collector)}` : ""}</div>
${data.mode === "demo" ? '<div class="banner">Demo mode: metrics below are synthetic sample data, not real deployments.</div>' : ""}
<div class="kpis">${kpis}</div>
<div class="grid">
  ${barChartSvg("Build time per release (s)", buildItems, "s")}
  ${barChartSvg("Deploy duration per release (s)", deployItems, "s", "#a78bfa")}
  ${lineChartSvg("Health-check latency (ms)", healthPoints, healthFails ? `${healthFails} failed sample(s)` : "")}
</div>
<section class="card" style="margin-top:16px">
  <h2>Releases</h2>
  <table>
    <thead><tr><th>Release</th><th>Commit</th><th>Timestamp</th><th>Build</th><th>Deploy</th><th>Rollbacks</th><th>Status</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="7" class="empty">No releases found</td></tr>'}</tbody>
  </table>
</section>
</body>
</html>`
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const outDir = resolve(args.out)
  mkdirSync(outDir, { recursive: true })

  let data
  let collectorNote = ""
  if (args.demo) {
    data = demoData()
    collectorNote = "demo"
  } else {
    const { currentVersion, releases } = collectFromGit(args.repo, args.last)
    const art = collectFromArtifacts(resolve(args.repo, args.artifacts), releases)
    const healthSamples = args.healthUrl ? await sampleHealth(args.healthUrl) : []
    data = {
      generatedAt: new Date().toISOString(),
      mode: "collect",
      currentVersion,
      releases,
      healthSamples,
      summary: summarize(releases, healthSamples),
      sources: {
        gitRepo: resolve(args.repo),
        artifactsDir: resolve(args.repo, args.artifacts),
        artifactsScanned: art.filesScanned,
        artifactsMatched: art.artifactsMatched,
        healthUrl: args.healthUrl,
      },
    }
    collectorNote = `git+artifacts (${art.artifactsMatched}/${art.filesScanned} artifact files matched)`
  }
  data.collector = collectorNote

  const htmlPath = join(outDir, "index.html")
  const jsonPath = join(outDir, "metrics.json")
  writeFileSync(htmlPath, renderHtml(data), "utf8")
  writeFileSync(jsonPath, JSON.stringify(data, null, 2), "utf8")

  console.log(`Wrote ${htmlPath}`)
  console.log(`Wrote ${jsonPath}`)
  if (data.mode === "demo") console.log("(demo mode — synthetic data)")
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
