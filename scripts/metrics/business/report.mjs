#!/usr/bin/env node
/**
 * Business metrics report for Spindle.
 *
 * Reads signup and product-analytics records (JSONL exports — see
 * docs/analytics/business-metrics.md for how to produce them) and computes
 * the business metric set defined in src/lib/metrics/business.ts: signups,
 * DAU/WAU, activation rate, week-1 retention proxy, engagement, top features,
 * and the paid-conversion proxy.
 *
 * Offline-friendly: no database, no network, no dependencies. Missing input
 * files produce a warning and are treated as empty rather than failing, so
 * the report works with partial data.
 *
 * Usage:
 *   node scripts/metrics/business/report.mjs --demo
 *   node scripts/metrics/business/report.mjs \
 *     --signups data/business/signups.jsonl \
 *     --events  data/business/events.jsonl \
 *     --format markdown --out-md reports/business.md
 *
 * Input formats (one JSON object per line):
 *
 *   signups.jsonl — { "id": "user-1", "signedUpAt": "2026-01-01T00:00:00Z" }
 *                   (also accepts "userId"/"email" and "createdAt"/"timestamp")
 *
 *   events.jsonl  — the /api/analytics event shape:
 *                   { "type": "feature_use", "name": "lab", "feature": "lab",
 *                     "userId": "user:user-1", "anonymousId": "…",
 *                     "timestamp": 1735689600000 }
 *                   (also accepts props.feature and ISO timestamps)
 *
 * Options:
 *   --signups <path>   signups JSONL (default: data/business/signups.jsonl)
 *   --events <path>    analytics events JSONL (default: data/business/events.jsonl)
 *   --demo             generate deterministic synthetic data instead of reading files
 *   --days <n>         trailing window in days (default: 30)
 *   --activation-days <n>  days after signup for activation (default: 7)
 *   --format <list>    comma-separated: text,json,markdown (default: text)
 *   --out-md <path>    also write the markdown report to a file
 *   --out-json <path>  also write the JSON report to a file
 *   -h, --help         show this help
 *
 * Exit codes: 0 ok, 2 usage error.
 */

import { createReadStream, existsSync, mkdirSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import readline from "node:readline"
import { fileURLToPath } from "node:url"

import {
  BUSINESS_METRIC_CATALOG,
  computeBusinessMetrics,
} from "../../../src/lib/metrics/business.ts"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, "../../..")
const DEFAULT_SIGNUPS = "data/business/signups.jsonl"
const DEFAULT_EVENTS = "data/business/events.jsonl"

const HELP = `business-metrics report — signups, activation, retention proxy, engagement

  node scripts/metrics/business/report.mjs --demo
  node scripts/metrics/business/report.mjs --signups <jsonl> --events <jsonl>

See the header comment in this file and docs/analytics/business-metrics.md
for input formats. Exit codes: 0 ok, 2 usage error.`

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const options = {
    help: false,
    demo: false,
    signups: DEFAULT_SIGNUPS,
    events: DEFAULT_EVENTS,
    days: 30,
    activationDays: 7,
    format: "text",
    outMd: null,
    outJson: null,
    error: false,
  }
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
      case "--signups":
        options.signups = next() ?? options.signups
        break
      case "--events":
        options.events = next() ?? options.events
        break
      case "--days":
        options.days = Number.parseInt(next() ?? "30", 10)
        break
      case "--activation-days":
        options.activationDays = Number.parseInt(next() ?? "7", 10)
        break
      case "--format":
        options.format = next() ?? "text"
        break
      case "--out-md":
        options.outMd = next() ?? null
        break
      case "--out-json":
        options.outJson = next() ?? null
        break
      default:
        if (arg.startsWith("--")) {
          console.error(`[business-metrics] unknown option "${arg}"`)
          options.error = true
        }
    }
  }
  return options
}

// ---------------------------------------------------------------------------
// Input loading — JSONL, tolerant of missing files and blank/malformed lines
// ---------------------------------------------------------------------------

async function readJsonl(path) {
  const records = []
  let skipped = 0
  const rl = readline.createInterface({
    input: createReadStream(path, { encoding: "utf8" }),
    crlfDelay: Infinity,
  })
  for await (const line of rl) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const parsed = JSON.parse(trimmed)
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) records.push(parsed)
      else skipped += 1
    } catch {
      skipped += 1
    }
  }
  return { records, skipped }
}

function loadJsonl(path, label) {
  const abs = resolve(repoRoot, path)
  if (!existsSync(abs)) {
    console.error(
      `[business-metrics] warning: ${label} file not found: ${path} (treating as empty)`,
    )
    return Promise.resolve({ records: [], skipped: 0 })
  }
  return readJsonl(abs).then(({ records, skipped }) => {
    if (skipped > 0) {
      console.error(
        `[business-metrics] warning: skipped ${skipped} malformed ${label} line(s) in ${path}`,
      )
    }
    return { records, skipped }
  })
}

// Normalize raw signup rows into BusinessUserInput[].
function normalizeSignups(rows) {
  const users = []
  for (const row of rows) {
    const id =
      typeof row.id === "string" && row.id
        ? row.id
        : typeof row.userId === "string" && row.userId
          ? row.userId
          : typeof row.email === "string" && row.email
            ? row.email
            : null
    const signedUpAt = row.signedUpAt ?? row.createdAt ?? row.timestamp ?? null
    if (id && signedUpAt !== null) users.push({ id, signedUpAt })
  }
  return users
}

// Normalize raw analytics rows into BusinessEventInput[]. The stored event
// shape (src/lib/analytics.ts StoredAnalyticsEvent) carries userId/anonymousId
// top-level; ingest payloads keep them inside `props`-adjacent fields too.
function normalizeEvents(rows) {
  const events = []
  for (const row of rows) {
    const props = row.props && typeof row.props === "object" ? row.props : {}
    const feature =
      typeof row.feature === "string" && row.feature
        ? row.feature
        : typeof props.feature === "string" && props.feature
          ? props.feature
          : null
    events.push({
      type: typeof row.type === "string" ? row.type : undefined,
      name: typeof row.name === "string" ? row.name : undefined,
      feature,
      userId:
        typeof row.userId === "string" && row.userId
          ? row.userId
          : typeof props.userId === "string" && props.userId
            ? props.userId
            : null,
      anonymousId: typeof row.anonymousId === "string" && row.anonymousId ? row.anonymousId : null,
      timestamp: row.timestamp ?? row.time ?? null,
      receivedAt: row.receivedAt ?? null,
    })
  }
  return events
}

// ---------------------------------------------------------------------------
// Demo fixture — deterministic synthetic signups + analytics events spread
// over ~120 days so every metric has data. mulberry32 matches
// scripts/metrics/log-metrics.mjs.
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

const DAY_MS = 24 * 60 * 60 * 1000

function demoData(now = Date.now()) {
  const rand = mulberry32(0xb017a1)
  const users = []
  const events = []
  const FEATURES = ["lab", "search", "files", "agent", "chat", "automations"]

  // ~4 signups/day baseline with gentle growth and weekday-ish noise.
  const signupDays = 120
  let seq = 0
  for (let d = signupDays; d >= 0; d--) {
    const dayStart = now - d * DAY_MS
    const growth = 1 + (signupDays - d) / signupDays / 2 // up to +50%
    const count = Math.max(0, Math.round((2 + rand() * 4) * growth))
    for (let i = 0; i < count; i++) {
      seq += 1
      const signedUpAt = dayStart - Math.floor(rand() * DAY_MS)
      const id = `demo-user-${seq}`
      users.push({ id, signedUpAt: new Date(signedUpAt).toISOString() })

      // Activity model: each user has a handful of "active days" — a burst
      // near signup for most, a longer tail for a minority. ~65% activate
      // (non-page_view event within 7d), ~45% are flagged week-1 retained.
      const activated = rand() < 0.65
      const retained = rand() < 0.45
      const accountAgeDays = Math.min(d, 40)
      const burstDays = 1 + Math.floor(rand() * 3) // 1–3 days near signup
      const tailDays = rand() < 0.35 ? 3 + Math.floor(rand() * Math.min(25, accountAgeDays)) : 0
      const activeDays = new Set()
      for (let i = 0; i < burstDays; i++)
        activeDays.add(Math.floor(rand() * Math.min(5, accountAgeDays + 1)))
      for (let i = 0; i < tailDays; i++) {
        activeDays.add(Math.floor(rand() * (accountAgeDays + 1)))
      }
      const emit = (dayOffset) => {
        const count = 2 + Math.floor(rand() * 6)
        for (let i = 0; i < count; i++) {
          const jitter = rand() * DAY_MS
          const timestamp = signedUpAt + dayOffset * DAY_MS + jitter
          if (timestamp > now || timestamp < signedUpAt) continue
          const ageDays = (timestamp - signedUpAt) / DAY_MS
          const isFeature = rand() < (activated ? 0.6 : ageDays < 1 ? 0.3 : 0.15)
          const feature = FEATURES[Math.floor(rand() * FEATURES.length)]
          if (isFeature) {
            events.push({
              type: "feature_use",
              name: feature,
              feature,
              userId: `user:${id}`,
              timestamp,
            })
          } else {
            events.push({ type: "page_view", name: "page_view", userId: `user:${id}`, timestamp })
          }
        }
      }
      // Flagged-retained users always get an active day inside days 7–14.
      if (retained && accountAgeDays >= 10 && signedUpAt + 10 * DAY_MS < now) {
        activeDays.add(7 + Math.floor(rand() * 7))
      }
      for (const dayOffset of activeDays) emit(dayOffset)
      // Guarantee activation for flagged users who got no early active day.
      const hasEarlyFeature = activated && [...activeDays].some((d) => d <= 7)
      if (activated && !hasEarlyFeature) {
        events.push({
          type: "feature_use",
          name: "lab",
          feature: "lab",
          userId: `user:${id}`,
          timestamp: signedUpAt + (1 + rand() * 5) * DAY_MS,
        })
      }
      // Rare conversion proxy (~2% of older users).
      if (rand() < 0.02 && signedUpAt + 3 * DAY_MS < now) {
        events.push({
          type: "feature_use",
          name: "checkout_completed",
          feature: "checkout",
          userId: `user:${id}`,
          timestamp: signedUpAt + (2 + rand() * 5) * DAY_MS,
        })
      }
    }
  }
  return { users, events }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const fmtInt = (n) => (typeof n === "number" ? n.toLocaleString("en-US") : "—")
const fmtPct = (n) => (typeof n === "number" ? `${(n * 100).toFixed(1)}%` : "n/a")
const fmtRatio = (n) => (typeof n === "number" ? n.toFixed(2) : "n/a")

function renderText(report) {
  const lines = []
  lines.push(
    `Business metrics — last ${report.windowDays} days (generated ${new Date(report.generatedAt).toISOString()})`,
  )
  lines.push(
    `Window: ${report.windowStart} → ${new Date(report.generatedAt).toISOString().slice(0, 10)}`,
  )
  lines.push("")
  lines.push(`Signups:            ${fmtInt(report.signups.total)}`)
  lines.push(
    `Active users:       DAU ${fmtInt(report.activeUsers.dau)} · WAU ${fmtInt(report.activeUsers.wau)} · window-unique ${fmtInt(report.activeUsers.mau)}`,
  )
  lines.push(
    `  events:           ${fmtInt(report.activeUsers.byType.total)} (page_view ${fmtInt(report.activeUsers.byType.pageViews)}, feature_use ${fmtInt(report.activeUsers.byType.featureUses)}, api_call ${fmtInt(report.activeUsers.byType.apiCalls)})`,
  )
  lines.push(
    `Activation (≤${report.activation.windowDays}d): ${fmtInt(report.activation.activated)}/${fmtInt(report.activation.eligible)} = ${fmtPct(report.activation.rate)}`,
  )
  lines.push(
    `Week-1 retention:   ${fmtInt(report.retentionWeek1.retained)}/${fmtInt(report.retentionWeek1.cohort)} = ${fmtPct(report.retentionWeek1.rate)} (proxy)`,
  )
  lines.push(
    `Engagement:         ${fmtRatio(report.engagement.eventsPerActiveUser)} events/active subject (${fmtInt(report.engagement.events)} events / ${fmtInt(report.engagement.activeSubjects)} subjects)`,
  )
  lines.push(
    `Conversions:        ${fmtInt(report.conversions.count)} checkout-style events = ${fmtPct(report.conversions.rate)} of signups (proxy — billing not wired)`,
  )
  lines.push("")
  lines.push("Top features (unique subjects):")
  for (const f of report.topFeatures.slice(0, 10)) {
    lines.push(
      `  ${f.feature.padEnd(16)} ${String(f.subjects).padStart(5)} subjects · ${f.events} events`,
    )
  }
  if (report.topFeatures.length === 0) lines.push("  (none)")
  return lines.join("\n")
}

function renderMarkdown(report) {
  const lines = []
  lines.push("# Business metrics report")
  lines.push("")
  lines.push(
    `- Window: \`${report.windowStart}\` → \`${new Date(report.generatedAt).toISOString().slice(0, 10)}\` (${report.windowDays} days)`,
  )
  lines.push(`- Generated: ${new Date(report.generatedAt).toISOString()}`)
  lines.push("")
  lines.push("| Metric | Value |")
  lines.push("| --- | --- |")
  lines.push(`| Signups | ${fmtInt(report.signups.total)} |`)
  lines.push(
    `| DAU / WAU / unique | ${fmtInt(report.activeUsers.dau)} / ${fmtInt(report.activeUsers.wau)} / ${fmtInt(report.activeUsers.mau)} |`,
  )
  lines.push(
    `| Events (pv/feature/api) | ${fmtInt(report.activeUsers.byType.pageViews)} / ${fmtInt(report.activeUsers.byType.featureUses)} / ${fmtInt(report.activeUsers.byType.apiCalls)} |`,
  )
  lines.push(
    `| Activation rate (≤${report.activation.windowDays}d) | ${fmtPct(report.activation.rate)} (${fmtInt(report.activation.activated)}/${fmtInt(report.activation.eligible)}) |`,
  )
  lines.push(
    `| Week-1 retention (proxy) | ${fmtPct(report.retentionWeek1.rate)} (${fmtInt(report.retentionWeek1.retained)}/${fmtInt(report.retentionWeek1.cohort)}) |`,
  )
  lines.push(`| Events per active subject | ${fmtRatio(report.engagement.eventsPerActiveUser)} |`)
  lines.push(
    `| Conversion proxy | ${fmtInt(report.conversions.count)} events · ${fmtPct(report.conversions.rate)} of signups |`,
  )
  lines.push("")
  lines.push("## Top features")
  lines.push("")
  lines.push("| Feature | Subjects | Events |")
  lines.push("| --- | ---: | ---: |")
  for (const f of report.topFeatures) {
    lines.push(`| ${f.feature} | ${f.subjects} | ${f.events} |`)
  }
  if (report.topFeatures.length === 0) lines.push("| (none) | 0 | 0 |")
  lines.push("")
  lines.push("## Metric catalog")
  lines.push("")
  lines.push("| Metric | Definition | Source | Target |")
  lines.push("| --- | --- | --- | --- |")
  for (const m of BUSINESS_METRIC_CATALOG) {
    lines.push(
      `| ${m.name}${m.available ? "" : " *(unavailable)*"} | ${m.definition} | ${m.source} | ${m.target} |`,
    )
  }
  return lines.join("\n")
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
  if (options.error || Number.isNaN(options.days) || options.days < 1) {
    console.error("[business-metrics] invalid arguments — see --help")
    return 2
  }

  const formats = new Set(
    options.format
      .split(",")
      .map((f) => f.trim())
      .filter(Boolean),
  )
  for (const f of formats) {
    if (!["text", "json", "markdown"].includes(f)) {
      console.error(`[business-metrics] unknown format "${f}" (expected text,json,markdown)`)
      return 2
    }
  }

  let users
  let events
  if (options.demo) {
    const data = demoData()
    users = data.users
    events = data.events
    console.error(`[business-metrics] demo mode: ${users.length} signups, ${events.length} events`)
  } else {
    const [signupRows, eventRows] = await Promise.all([
      loadJsonl(options.signups, "signups"),
      loadJsonl(options.events, "events"),
    ])
    users = normalizeSignups(signupRows.records)
    events = normalizeEvents(eventRows.records)
  }

  const report = computeBusinessMetrics(users, events, {
    windowDays: options.days,
    activationWindowDays: options.activationDays,
  })

  const outputs = []
  if (formats.has("text")) outputs.push(renderText(report))
  if (formats.has("markdown")) outputs.push(renderMarkdown(report))
  if (formats.has("json")) outputs.push(JSON.stringify(report, null, 2))
  console.log(outputs.join("\n\n"))

  if (options.outJson) {
    const path = resolve(repoRoot, options.outJson)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, JSON.stringify(report, null, 2) + "\n", "utf8")
    console.error(`[business-metrics] wrote JSON report to ${options.outJson}`)
  }
  if (options.outMd) {
    const path = resolve(repoRoot, options.outMd)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, renderMarkdown(report) + "\n", "utf8")
    console.error(`[business-metrics] wrote markdown report to ${options.outMd}`)
  }
  return 0
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error("[business-metrics] fatal:", error)
    process.exit(2)
  },
)
