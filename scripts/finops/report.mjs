#!/usr/bin/env node
// FinOps cost report for Spindle's self-hosted origin stack.
//
//   node scripts/finops/report.mjs [options]
//
// Collects what it can from the local machine — `docker stats`, on-disk
// artifact sizes (backups, .next, docker json-file logs) — and combines it
// with a static price table for the Hetzner/Cloudflare/B2/LLM bill described
// in docs/runbooks/hosting.md §4. Produces a JSON + markdown cost report.
//
//   --demo            fabricate all inputs; never touches docker, disk, or
//                     config. Safe for offline verification and CI.
//   --out <dir>       output directory (default scripts/finops/.output)
//   --usage-file <p>  LLM usage JSON (env FINOPS_USAGE_FILE). Shape:
//                       { "periodStart": "...", "periodEnd": "...",
//                         "requests": n, "inputTokens": n, "outputTokens": n,
//                         "costUsd": n }            — totals for the period
//                       or { "daily": [ {date, requests, inputTokens,
//                         outputTokens, costUsd}, ... ] }
//                     When `costUsd` is absent the report prices tokens with
//                     the rates in PRICE_TABLE.llm.
//   --backup-dir <p>  extra backup dir to measure (repeatable; env
//                     FINOPS_BACKUP_DIRS is a colon-separated list)
//   --host <name>     label for the host section (default: hostname)
//   --json            print the JSON report to stdout as well
//   --help, -h        show this message
//
// Everything is offline-tolerant: if docker or a path is unavailable the
// corresponding section is marked "unavailable" and the report still renders.
// Exit codes: 0 success, 2 usage error.
/* eslint-disable no-restricted-properties --
   entrypoint script: reads FINOPS_ and SPINDLE_ROOT env vars before any app
   code loads, so src/lib/env.ts cannot be used here. */

import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { hostname } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const DEFAULT_OUT = join(ROOT, "scripts", "finops", ".output")
const DEFAULT_USAGE_FILE = join(ROOT, "scripts", "finops", "usage.json")

// ---------------------------------------------------------------------------
// Static price table — ESTIMATES. Reconcile against real invoices quarterly
// and update docs/finops/cost-model.md. Sources: docs/runbooks/hosting.md §4
// (beta estimate $155–185/mo), provider list prices at time of writing.
// ---------------------------------------------------------------------------

const PRICE_TABLE = {
  // Fixed monthly infrastructure (production + staging).
  hosts: [
    {
      env: "production",
      provider: "hetzner",
      instance: "AX42-1 (8C/16T, 64 GB, 2x512 GB NVMe RAID1)",
      monthlyUsd: 64, // ~€59/mo; verify against Hetzner invoice
      ramGb: 64,
      diskGb: 480, // usable after RAID1 + filesystem
    },
    {
      env: "staging",
      provider: "hetzner",
      instance: "CPX31 or AX41 (smaller instance)",
      monthlyUsd: 16, // ~€15/mo; verify
      ramGb: 8,
      diskGb: 160,
    },
  ],
  // Variable storage.
  b2: {
    storageUsdPerTbMonth: 6, // Backblaze B2 pay-as-you-go list price
    downloadUsdPerGb: 0, // egress free up to 3x stored; cap alert at 3 TB (hosting.md §4)
  },
  cloudflareProUsd: 20,
  sentryUsd: 20, // org spend cap per hosting.md §4
  resendUsd: 0, // beta quota, no paid plan
  // LLM blended rates per 1M tokens — used only when the usage file omits
  // costUsd. Adjust to the actual provider/model in Infisical.
  llm: {
    inputUsdPerMillion: 3,
    outputUsdPerMillion: 15,
  },
  // Local disk fill projection uses this as the assumed free-space target.
  diskFreeFloorGb: 50,
}

// Backup retention drives storage growth; keep in sync with
// BACKUP_RETENTION_COUNT default in scripts/db/backup/backup.ts (14) and the
// cron example in docs/runbooks/database-backup.md (30).
const BACKUP_RETENTION_DEFAULT = 14

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2)
if (argv.includes("--help") || argv.includes("-h")) {
  console.log(`Usage: node scripts/finops/report.mjs [options]

  --demo               fabricate all inputs (offline verification)
  --out <dir>          output dir (default ${DEFAULT_OUT})
  --usage-file <path>  LLM usage JSON (default ${DEFAULT_USAGE_FILE})
  --backup-dir <path>  extra dir to measure for backup storage (repeatable)
  --host <name>        host label (default: ${hostname()})
  --json               also print the JSON report to stdout
  --help, -h           show this message`)
  process.exit(0)
}

function flagValue(name) {
  const i = argv.indexOf(name)
  return i >= 0 ? argv[i + 1] : undefined
}
function flags(name) {
  const out = []
  for (let i = 0; i < argv.length; i++) if (argv[i] === name && argv[i + 1]) out.push(argv[i + 1])
  return out
}

const DEMO = argv.includes("--demo")
const OUT_DIR = resolve(flagValue("--out") ?? DEFAULT_OUT)
const USAGE_FILE = resolve(
  flagValue("--usage-file") ?? process.env.FINOPS_USAGE_FILE ?? DEFAULT_USAGE_FILE,
)
const EXTRA_BACKUP_DIRS = [
  ...flags("--backup-dir"),
  ...(process.env.FINOPS_BACKUP_DIRS ?? "").split(":").filter(Boolean),
].map((p) => resolve(p))
const HOST_LABEL = flagValue("--host") ?? hostname()
const PRINT_JSON = argv.includes("--json")

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function run(cmd, args, opts = {}) {
  try {
    return execFileSync(cmd, args, { encoding: "utf8", timeout: 15000, ...opts })
  } catch {
    return null
  }
}

/** Recursive byte total for a directory; null when missing/unreadable. */
function dirSize(path, { maxDepth = 12, budget = { n: 200_000 } } = {}) {
  if (!existsSync(path)) return null
  let total = 0
  let truncated = false
  const stack = [{ p: path, d: 0 }]
  while (stack.length) {
    if (budget.n-- <= 0) {
      truncated = true
      break
    }
    const { p, d } = stack.pop()
    let st
    try {
      st = statSync(p)
    } catch {
      continue
    }
    if (st.isFile()) {
      total += st.size
    } else if (st.isDirectory() && d < maxDepth) {
      let entries
      try {
        entries = readdirSync(p, { withFileTypes: true })
      } catch {
        continue
      }
      for (const e of entries) stack.push({ p: join(p, e.name), d: d + 1 })
    }
  }
  return { bytes: total, truncated }
}

function gb(bytes) {
  return bytes / 1024 ** 3
}
function mb(bytes) {
  return bytes / 1024 ** 2
}
function fmtGb(bytes) {
  const g = gb(bytes)
  return g >= 10 ? `${g.toFixed(1)} GB` : `${g.toFixed(2)} GB`
}
function fmtMb(bytes) {
  const m = mb(bytes)
  return m >= 1024 ? fmtGb(bytes) : `${m.toFixed(1)} MB`
}
function fmtUsd(n) {
  return Number.isFinite(n) ? `$${n.toFixed(2)}` : "n/a"
}

// ---------------------------------------------------------------------------
// Collectors — each returns { status, ... }; never throw.
// ---------------------------------------------------------------------------

function collectDockerStats() {
  if (DEMO) {
    return {
      status: "demo",
      sampledAt: new Date().toISOString(),
      containers: [
        {
          name: "spindle-app-1",
          service: "app",
          cpuPercent: 3.2,
          memUsage: "1.4GiB / 2GiB",
          memPercent: 71.0,
          netIo: "1.2GB / 3.4GB",
          pids: 42,
        },
        {
          name: "spindle-worker-1",
          service: "worker",
          cpuPercent: 1.1,
          memUsage: "640MiB / 1GiB",
          memPercent: 62.5,
          netIo: "900MB / 1.1GB",
          pids: 18,
        },
        {
          name: "spindle-postgres-1",
          service: "postgres",
          cpuPercent: 4.8,
          memUsage: "2.1GiB / 4GiB",
          memPercent: 53.1,
          netIo: "5.6GB / 2.2GB",
          pids: 31,
        },
        {
          name: "spindle-valkey-1",
          service: "valkey",
          cpuPercent: 0.4,
          memUsage: "410MiB / 512MiB",
          memPercent: 80.0,
          netIo: "2.1GB / 2.1GB",
          pids: 12,
        },
        {
          name: "spindle-cloudflared-1",
          service: "cloudflared",
          cpuPercent: 0.2,
          memUsage: "38MiB / 128MiB",
          memPercent: 29.7,
          netIo: "8.9GB / 7.3GB",
          pids: 9,
        },
        {
          name: "spindle-cloudflared-2",
          service: "cloudflared",
          cpuPercent: 0.2,
          memUsage: "36MiB / 128MiB",
          memPercent: 28.1,
          netIo: "8.7GB / 7.1GB",
          pids: 9,
        },
        {
          name: "spindle-docker-socket-proxy-1",
          service: "docker-socket-proxy",
          cpuPercent: 0.0,
          memUsage: "12MiB / 64MiB",
          memPercent: 18.8,
          netIo: "44MB / 60MB",
          pids: 6,
        },
      ],
    }
  }
  const out = run("docker", ["stats", "--no-stream", "--format", "{{json .}}"])
  if (out === null)
    return { status: "unavailable", reason: "docker stats failed or docker not present" }
  const containers = out
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        const j = JSON.parse(line)
        const name = (j.Name ?? "").replace(/^\//, "")
        const service = name.replace(/-\d+$/, "")
        return {
          name,
          service,
          cpuPercent: parseFloat(j.CPUPerc) || 0,
          memUsage: j.MemUsage,
          memPercent: parseFloat(j.MemPerc) || 0,
          netIo: j.NetIO,
          pids: parseInt(j.PIDs, 10) || 0,
        }
      } catch {
        return null
      }
    })
    .filter(Boolean)
  if (containers.length === 0)
    return { status: "unavailable", reason: "docker stats returned no containers" }
  return { status: "ok", sampledAt: new Date().toISOString(), containers }
}

/** Sum memory bytes from a docker "MemUsage" string like "1.4GiB / 2GiB". */
function parseMemUsage(memUsage) {
  const m = /([\d.]+)\s*([KMGT]i?B)/i.exec(memUsage ?? "")
  if (!m) return null
  const mult = { k: 1, m: 2, g: 3, t: 4 }[m[2][0].toLowerCase()] ?? 0
  const bytes = parseFloat(m[1]) * 1024 ** mult
  return Number.isFinite(bytes) ? bytes : null
}

function collectDisk() {
  const targets = [
    { key: "next-build-cache", label: ".next build dir", path: join(ROOT, ".next") },
    { key: "repo-backups", label: "repo backups/", path: join(ROOT, "backups") },
    ...EXTRA_BACKUP_DIRS.map((p) => ({ key: `backup:${p}`, label: `backup dir ${p}`, path: p })),
  ]
  // Common production locations (SPINDLE_ROOT=/srv/spindle per bootstrap.sh).
  for (const base of [process.env.SPINDLE_ROOT ?? "/srv/spindle", "/srv/spindle-staging"]) {
    targets.push({
      key: `srv-backups:${base}`,
      label: `backups under ${base}`,
      path: join(base, "backups"),
    })
    targets.push({
      key: `srv-projects:${base}`,
      label: `projects under ${base}`,
      path: join(base, "projects"),
    })
  }
  if (DEMO) {
    return {
      status: "demo",
      measuredAt: new Date().toISOString(),
      entries: [
        {
          key: "next-build-cache",
          label: ".next build dir",
          bytes: 3.1 * 1024 ** 3,
          truncated: false,
        },
        { key: "repo-backups", label: "repo backups/", bytes: 0, truncated: false },
        {
          key: "srv-backups:/srv/spindle",
          label: "backups under /srv/spindle",
          bytes: 18.4 * 1024 ** 3,
          truncated: false,
        },
        {
          key: "srv-projects:/srv/spindle",
          label: "projects under /srv/spindle",
          bytes: 412 * 1024 ** 3,
          truncated: false,
        },
        {
          key: "srv-backups:/srv/spindle-staging",
          label: "backups under /srv/spindle-staging",
          bytes: 6.2 * 1024 ** 3,
          truncated: false,
        },
      ],
    }
  }
  const entries = targets.map((t) => {
    const r = dirSize(t.path)
    return { ...t, bytes: r?.bytes ?? 0, truncated: r?.truncated ?? false, present: r !== null }
  })
  const present = entries.some((e) => e.present)
  return {
    status: present ? "ok" : "unavailable",
    measuredAt: new Date().toISOString(),
    reason: present ? undefined : "none of the known paths exist on this host",
    entries: entries.filter((e) => e.present || e.bytes > 0),
  }
}

function collectDockerLogs() {
  if (DEMO) {
    return {
      status: "demo",
      containers: [
        { name: "spindle-app-1", logBytes: 84 * 1024 ** 2, rotationCapBytes: 100 * 1024 ** 2 },
        { name: "spindle-worker-1", logBytes: 41 * 1024 ** 2, rotationCapBytes: 100 * 1024 ** 2 },
        { name: "spindle-postgres-1", logBytes: 12 * 1024 ** 2, rotationCapBytes: 100 * 1024 ** 2 },
        { name: "spindle-valkey-1", logBytes: 4 * 1024 ** 2, rotationCapBytes: 100 * 1024 ** 2 },
        {
          name: "spindle-cloudflared-1",
          logBytes: 22 * 1024 ** 2,
          rotationCapBytes: 100 * 1024 ** 2,
        },
        {
          name: "spindle-cloudflared-2",
          logBytes: 21 * 1024 ** 2,
          rotationCapBytes: 100 * 1024 ** 2,
        },
        {
          name: "spindle-docker-socket-proxy-1",
          logBytes: 1 * 1024 ** 2,
          rotationCapBytes: 100 * 1024 ** 2,
        },
      ],
      note: "json-file driver capped at 20m x 5 files per service (infra/origin/compose.yaml x-logging)",
    }
  }
  const ids = run("docker", ["ps", "-aq"])
  if (ids === null) return { status: "unavailable", reason: "docker not present" }
  const containers = []
  for (const id of ids.split("\n").filter(Boolean)) {
    const name = run("docker", ["inspect", "-f", "{{.Name}}", id])?.trim().replace(/^\//, "")
    const logPath = run("docker", ["inspect", "-f", "{{.LogPath}}", id])?.trim()
    if (!name || !logPath) continue
    const st = statSync(logPath, { throwIfNoEntry: false })
    // Compose logging opts: max-size "20m", max-file "5" -> 100 MB cap.
    containers.push({
      name,
      logBytes: st?.isFile() ? st.size : 0,
      rotationCapBytes: 100 * 1024 ** 2,
    })
  }
  if (containers.length === 0)
    return { status: "unavailable", reason: "no docker containers or logs readable" }
  return {
    status: "ok",
    containers,
    note: "json-file driver; per-service cap from compose x-logging",
  }
}

function collectLlmUsage() {
  if (DEMO) {
    return {
      status: "demo",
      source: "demo fixture",
      periodStart: "2026-11-01",
      periodEnd: "2026-11-30",
      requests: 18420,
      inputTokens: 9_840_000,
      outputTokens: 2_310_000,
      costUsd:
        (9_840_000 / 1e6) * PRICE_TABLE.llm.inputUsdPerMillion +
        (2_310_000 / 1e6) * PRICE_TABLE.llm.outputUsdPerMillion,
      costSource: "estimated from PRICE_TABLE.llm rates",
    }
  }
  if (!existsSync(USAGE_FILE)) {
    return {
      status: "unavailable",
      reason: `no usage file at ${USAGE_FILE} — LLM calls are made by the external backend; export its usage summary here (see --usage-file)`,
    }
  }
  let parsed
  try {
    parsed = JSON.parse(readFileSync(USAGE_FILE, "utf8"))
  } catch (e) {
    return { status: "unavailable", reason: `usage file is not valid JSON: ${e.message}` }
  }
  const daily = Array.isArray(parsed.daily) ? parsed.daily : null
  const agg = daily
    ? daily.reduce(
        (a, d) => ({
          requests: a.requests + (d.requests ?? 0),
          inputTokens: a.inputTokens + (d.inputTokens ?? 0),
          outputTokens: a.outputTokens + (d.outputTokens ?? 0),
          costUsd: a.costUsd + (d.costUsd ?? 0),
        }),
        { requests: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 },
      )
    : {
        requests: parsed.requests ?? 0,
        inputTokens: parsed.inputTokens ?? 0,
        outputTokens: parsed.outputTokens ?? 0,
        costUsd: parsed.costUsd ?? null,
      }
  const priced =
    agg.costUsd != null
      ? agg.costUsd
      : (agg.inputTokens / 1e6) * PRICE_TABLE.llm.inputUsdPerMillion +
        (agg.outputTokens / 1e6) * PRICE_TABLE.llm.outputUsdPerMillion
  return {
    status: "ok",
    source: USAGE_FILE,
    periodStart: parsed.periodStart ?? null,
    periodEnd: parsed.periodEnd ?? null,
    days: daily?.length ?? null,
    ...agg,
    costUsd: priced,
    costSource: agg.costUsd != null ? "reported" : "estimated from PRICE_TABLE.llm rates",
  }
}

// ---------------------------------------------------------------------------
// Report assembly
// ---------------------------------------------------------------------------

function buildReport() {
  const docker = collectDockerStats()
  const disk = collectDisk()
  const logs = collectDockerLogs()
  const llm = collectLlmUsage()

  // --- Compute utilization -------------------------------------------------
  let compute = null
  if (docker.status !== "unavailable" && docker.containers.length) {
    const totalMemBytes = docker.containers.reduce(
      (s, c) => s + (parseMemUsage(c.memUsage) ?? 0),
      0,
    )
    const prodHost = PRICE_TABLE.hosts.find((h) => h.env === "production")
    compute = {
      containerCount: docker.containers.length,
      totalMemUsedBytes: totalMemBytes,
      totalMemUsedGb: gb(totalMemBytes),
      hostRamGb: prodHost.ramGb,
      hostMemUtilizationPct: prodHost.ramGb
        ? (totalMemBytes / (prodHost.ramGb * 1024 ** 3)) * 100
        : null,
      totalCpuPercent: docker.containers.reduce((s, c) => s + c.cpuPercent, 0),
      byService: Object.entries(
        docker.containers.reduce((acc, c) => {
          acc[c.service] = (acc[c.service] ?? 0) + c.cpuPercent
          return acc
        }, {}),
      ).map(([service, cpuPercent]) => ({ service, cpuPercent })),
      note:
        docker.status === "demo"
          ? "demo data"
          : "single instantaneous sample — run repeatedly (e.g. cron hourly) for a utilization trend",
    }
  }

  // --- Disk / storage -------------------------------------------------------
  const diskEntries = disk.status === "unavailable" ? [] : disk.entries
  const backupBytes = diskEntries
    .filter((e) => e.key.includes("backup"))
    .reduce((s, e) => s + e.bytes, 0)
  const projectsBytes = diskEntries
    .filter((e) => e.key.includes("projects"))
    .reduce((s, e) => s + e.bytes, 0)
  const nextBytes = diskEntries
    .filter((e) => e.key === "next-build-cache")
    .reduce((s, e) => s + e.bytes, 0)
  const diskTotal = diskEntries.reduce((s, e) => s + e.bytes, 0)

  const logBytes =
    logs.status === "unavailable" ? 0 : logs.containers.reduce((s, c) => s + c.logBytes, 0)
  const logCapBytes =
    logs.status === "unavailable"
      ? 0
      : logs.containers.reduce((s, c) => s + (c.rotationCapBytes ?? 0), 0)

  // Projected B2 off-box backup cost: retention x avg artifact size.
  // Artifact size ~ latest backup dir size / retention count is only an
  // approximation when dir holds retention-many artifacts; report both.
  const avgArtifactBytes = backupBytes > 0 ? backupBytes / BACKUP_RETENTION_DEFAULT : 0
  const projectedB2Tb = (avgArtifactBytes * BACKUP_RETENTION_DEFAULT) / 1024 ** 4

  // --- Fixed + variable monthly cost ----------------------------------------
  const hostMonthly = PRICE_TABLE.hosts.reduce((s, h) => s + h.monthlyUsd, 0)
  const fixedMonthly =
    hostMonthly + PRICE_TABLE.cloudflareProUsd + PRICE_TABLE.sentryUsd + PRICE_TABLE.resendUsd
  const b2Measured = backupBytes > 0
  const variableMonthly = {
    // null when no backup dir was measurable — don't silently report $0.
    b2StorageUsd: b2Measured ? projectedB2Tb * PRICE_TABLE.b2.storageUsdPerTbMonth : null,
    llmUsd: llm.status === "unavailable" ? null : llm.costUsd,
  }
  const estimatedMonthlyUsd =
    fixedMonthly + (variableMonthly.b2StorageUsd ?? 0) + (variableMonthly.llmUsd ?? 0)

  // --- Right-sizing signals --------------------------------------------------
  const recommendations = []
  if (compute?.hostMemUtilizationPct != null) {
    if (compute.hostMemUtilizationPct < 25)
      recommendations.push({
        severity: "info",
        text: `Container memory is ~${compute.hostMemUtilizationPct.toFixed(0)}% of host RAM — the AX42-1 may be oversized for current load; review before renewing.`,
      })
    else if (compute.hostMemUtilizationPct > 85)
      recommendations.push({
        severity: "warn",
        text: `Container memory is ~${compute.hostMemUtilizationPct.toFixed(0)}% of host RAM — approaching the ceiling; sessions queue at 12 concurrent labs.`,
      })
  }
  if (diskEntries.some((e) => e.truncated))
    recommendations.push({
      severity: "warn",
      text: "A measured directory hit the scan budget — sizes are lower bounds.",
    })
  if (diskTotal > 0) {
    const freeEstimate = PRICE_TABLE.hosts[0].diskGb * 1024 ** 3 - diskTotal
    if (freeEstimate / 1024 ** 3 < PRICE_TABLE.diskFreeFloorGb)
      recommendations.push({
        severity: "warn",
        text: `Measured footprint ${fmtGb(diskTotal)} leaves <${PRICE_TABLE.diskFreeFloorGb} GB headroom on a ${PRICE_TABLE.hosts[0].diskGb} GB disk.`,
      })
  }
  if (logs.status !== "unavailable" && logCapBytes > 0 && logBytes / logCapBytes > 0.8)
    recommendations.push({
      severity: "info",
      text: `Docker logs at ${Math.round((logBytes / logCapBytes) * 100)}% of rotation cap — rotation is doing its job; no action.`,
    })
  if (llm.status === "unavailable")
    recommendations.push({
      severity: "info",
      text: "LLM usage not measured — wire FINOPS_USAGE_FILE to the backend usage export to track the $100/mo cap (hosting.md §4).",
    })
  else if (variableMonthly.llmUsd != null && variableMonthly.llmUsd > 100)
    recommendations.push({
      severity: "warn",
      text: `LLM spend ${fmtUsd(variableMonthly.llmUsd)} exceeds the $100/mo hard cap — check the provider project budget.`,
    })

  return {
    generatedAt: new Date().toISOString(),
    host: HOST_LABEL,
    mode: DEMO ? "demo" : "live",
    priceTable: "ESTIMATES — reconcile with invoices; see docs/finops/cost-model.md",
    sections: { docker, disk, logs, llm, compute },
    storage: {
      backupBytes,
      projectsBytes,
      nextBuildBytes: nextBytes,
      dockerLogBytes: logBytes,
      dockerLogCapBytes: logCapBytes,
      measuredTotalBytes: diskTotal + logBytes,
      backupRetentionCount: BACKUP_RETENTION_DEFAULT,
      avgBackupArtifactBytes: avgArtifactBytes,
      projectedB2Tb,
    },
    cost: {
      fixedMonthlyUsd: fixedMonthly,
      hostMonthlyUsd: hostMonthly,
      cloudflareProUsd: PRICE_TABLE.cloudflareProUsd,
      sentryUsd: PRICE_TABLE.sentryUsd,
      b2StorageUsd: variableMonthly.b2StorageUsd,
      b2Measured,
      llmUsd: variableMonthly.llmUsd,
      estimatedMonthlyUsd,
      betaEstimateRangeUsd: [155, 185], // docs/runbooks/hosting.md §4
    },
    recommendations,
  }
}

// ---------------------------------------------------------------------------
// Markdown rendering
// ---------------------------------------------------------------------------

function renderMarkdown(r) {
  const L = []
  L.push(`# FinOps cost report — ${r.host}`)
  L.push("")
  L.push(`Generated: ${r.generatedAt} · mode: **${r.mode}**`)
  L.push(`> ${r.priceTable}`)
  L.push("")
  L.push("## Monthly cost estimate")
  L.push("")
  L.push("| Component | USD/mo | Basis |")
  L.push("| --- | ---: | --- |")
  L.push(
    `| Hetzner hosts (prod + staging) | ${fmtUsd(r.cost.hostMonthlyUsd)} | fixed; see cost-model.md |`,
  )
  L.push(`| Cloudflare Pro | ${fmtUsd(r.cost.cloudflareProUsd)} | plan |`)
  L.push(`| Sentry | ${fmtUsd(r.cost.sentryUsd)} | org cap |`)
  L.push(`| Resend | ${fmtUsd(0)} | beta quota |`)
  L.push(
    `| B2 off-box backups | ${r.cost.b2StorageUsd == null ? "not measured" : fmtUsd(r.cost.b2StorageUsd)} | ${r.storage.projectedB2Tb.toFixed(2)} TB projected at $6/TB |`,
  )
  L.push(
    `| LLM API | ${r.cost.llmUsd == null ? "n/a" : fmtUsd(r.cost.llmUsd)} | ${r.sections.llm.status === "ok" || r.sections.llm.status === "demo" ? (r.sections.llm.costSource ?? "reported") : "not measured"} |`,
  )
  L.push(
    `| **Estimated total** | **${fmtUsd(r.cost.estimatedMonthlyUsd)}** | hosting.md beta range $155–185 |`,
  )
  L.push("")

  L.push("## Compute")
  if (r.sections.compute) {
    const c = r.sections.compute
    L.push("")
    L.push(
      `- Containers sampled: ${c.containerCount} · total CPU ${c.totalCpuPercent.toFixed(1)}% · memory ${fmtGb(c.totalMemUsedBytes)} (${c.hostMemUtilizationPct?.toFixed(1) ?? "?"}% of ${c.hostRamGb} GB host)`,
    )
    L.push(`- ${c.note}`)
    if (r.sections.docker.containers?.length)
      L.push("", "| Container | CPU % | Memory |", "| --- | ---: | --- |")
    for (const ct of r.sections.docker.containers)
      L.push(`| ${ct.name} | ${ct.cpuPercent.toFixed(1)} | ${ct.memUsage} |`)
  } else {
    L.push("", `_unavailable: ${r.sections.docker.reason ?? "no data"}_`)
  }
  L.push("")

  L.push("## Storage")
  L.push("")
  if (r.sections.disk.status !== "unavailable") {
    L.push("| Path | Size |", "| --- | ---: |")
    for (const e of r.sections.disk.entries)
      L.push(`| ${e.label}${e.truncated ? " (truncated scan)" : ""} | ${fmtGb(e.bytes)} |`)
    L.push("")
    L.push(
      `- Backup retention: keep newest ${r.storage.backupRetentionCount} artifacts${r.cost.b2Measured ? ` (~${fmtMb(r.storage.avgBackupArtifactBytes)} avg artifact)` : " — no backup dir measured"}`,
    )
    L.push(
      `- Docker json-file logs: ${fmtMb(r.storage.dockerLogBytes)} used of ${fmtMb(r.storage.dockerLogCapBytes)} rotation cap`,
    )
  } else {
    L.push(`_unavailable: ${r.sections.disk.reason ?? "no data"}_`)
  }
  L.push("")

  L.push("## LLM usage")
  L.push("")
  const llm = r.sections.llm
  if (llm.status === "ok" || llm.status === "demo") {
    L.push(
      `- Period: ${llm.periodStart ?? "?"} → ${llm.periodEnd ?? "?"} · source: ${llm.source ?? llm.status}`,
    )
    L.push(
      `- Requests: ${llm.requests?.toLocaleString() ?? "?"} · input tokens: ${llm.inputTokens?.toLocaleString() ?? "?"} · output tokens: ${llm.outputTokens?.toLocaleString() ?? "?"}`,
    )
    L.push(`- Cost: ${fmtUsd(llm.costUsd)} (${llm.costSource ?? "reported"})`)
  } else {
    L.push(`_unavailable: ${llm.reason ?? "no data"}_`)
  }
  L.push("")

  L.push("## Recommendations")
  L.push("")
  if (r.recommendations.length === 0)
    L.push("- None — all measured signals within expected ranges.")
  for (const rec of r.recommendations) L.push(`- **${rec.severity}** — ${rec.text}`)
  L.push("")
  L.push(
    "_Static guidance lives in docs/finops/optimization.md; cost drivers in docs/finops/cost-model.md._",
  )
  return L.join("\n") + "\n"
}

// ---------------------------------------------------------------------------

function main() {
  const report = buildReport()
  mkdirSync(OUT_DIR, { recursive: true })
  const base = join(
    OUT_DIR,
    `finops-report-${report.generatedAt.slice(0, 10)}${report.mode === "demo" ? "-demo" : ""}`,
  )
  writeFileSync(`${base}.json`, JSON.stringify(report, null, 2) + "\n")
  writeFileSync(`${base}.md`, renderMarkdown(report))
  console.log(`[finops] wrote ${base}.json and ${base}.md (mode: ${report.mode})`)
  if (PRINT_JSON) console.log(JSON.stringify(report, null, 2))
}

main()
