#!/usr/bin/env node
/**
 * Retention report — N-day retention, churn, DAU/WAU/MAU windows, and a
 * pooled survival curve computed over user activity events.
 *
 * Data sources:
 *   --demo            deterministic synthetic event stream (default)
 *   --file <path>     JSONL export: one event per line,
 *                     { "userId": "...", "timestamp": 1730000000000 }
 *                     (ISO-8601 strings also accepted)
 *   --json            emit the raw report as JSON instead of markdown
 *
 * Usage:
 *   node scripts/analytics/retention/report.mjs --demo
 *   node scripts/analytics/retention/report.mjs --file export.jsonl --json
 *   node scripts/analytics/retention/report.mjs --file export.jsonl > report.md
 *
 * The metric math lives in src/lib/retention.ts (pure, unit-tested); this
 * script is only I/O + formatting.
 */

import { readFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { buildRetentionReport, generateDemoActivityEvents } from "../../../src/lib/retention.ts"

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..")

function parseArgs(argv) {
  const args = { demo: false, file: null, json: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--demo") args.demo = true
    else if (arg === "--json") args.json = true
    else if (arg === "--file") args.file = argv[++i]
    else if (arg === "--help" || arg === "-h") args.help = true
    else {
      console.error(`Unknown argument: ${arg}`)
      process.exit(2)
    }
  }
  return args
}

function usage() {
  console.log(`Usage: node scripts/analytics/retention/report.mjs [--demo|--file <path>] [--json]

  --demo       Use the built-in deterministic demo event stream (default).
  --file PATH  Read JSONL events: {"userId":"...","timestamp":<epoch-ms|ISO>}.
  --json       Print the raw report JSON instead of markdown.`)
}

/** Parse one JSONL line into an ActivityEventInput, or null if malformed. */
function parseEventLine(line, lineNo) {
  const trimmed = line.trim()
  if (!trimmed) return null
  let parsed
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    console.error(`Skipping malformed JSON on line ${lineNo}`)
    return null
  }
  const userId = parsed.userId ?? parsed.user_id ?? parsed.user
  let timestamp = parsed.timestamp ?? parsed.ts ?? parsed.time
  if (typeof timestamp === "string") timestamp = Date.parse(timestamp)
  if (typeof timestamp === "number" && Number.isFinite(timestamp)) {
    return { userId: typeof userId === "string" ? userId : "", timestamp }
  }
  console.error(`Skipping line ${lineNo}: no usable timestamp`)
  return null
}

async function loadEvents(filePath) {
  const text = await readFile(filePath, "utf8")
  const events = []
  const lines = text.split("\n")
  for (let i = 0; i < lines.length; i++) {
    const event = parseEventLine(lines[i], i + 1)
    if (event) events.push(event)
  }
  return events
}

function pct(value) {
  return value === null || value === undefined ? "—" : `${(value * 100).toFixed(1)}%`
}

function markdown(report) {
  const lines = []
  lines.push("# Retention report")
  lines.push("")
  lines.push(`Generated: ${report.generatedAt} · Source: ${report.dataSource}`)
  lines.push("")
  lines.push(
    `- Users: **${report.users}** · Events: **${report.events}**` +
      (report.excludedEvents > 0 ? ` · Excluded events: ${report.excludedEvents}` : ""),
  )
  lines.push("")

  lines.push("## Activity windows")
  lines.push("")
  lines.push("| Metric | Users |")
  lines.push("|---|---:|")
  lines.push(`| DAU (1d) | ${report.windows.dau} |`)
  lines.push(`| WAU (7d) | ${report.windows.wau} |`)
  lines.push(`| MAU (30d) | ${report.windows.mau} |`)
  lines.push(`| DAU/WAU stickiness | ${pct(report.windows.dauWauRatio)} |`)
  lines.push("")

  const c = report.churn
  lines.push("## Churn (trailing window)")
  lines.push("")
  lines.push(
    `Window: **${c.windowDays} days** — cohort = users active in the *previous* ${c.windowDays}-day window.`,
  )
  lines.push("")
  lines.push("| Cohort | Churned | Retained | Churn rate |")
  lines.push("|---:|---:|---:|---:|")
  lines.push(`| ${c.cohortSize} | ${c.churned} | ${c.retained} | ${pct(c.churnRate)} |`)
  lines.push("")

  lines.push("## N-day retention by first-activity cohort")
  lines.push("")
  lines.push(
    "Retention = share of the cohort with ≥1 event exactly N days after their first-activity day. `—` = day not yet elapsed.",
  )
  lines.push("")
  if (report.nDayRetention.length === 0) {
    lines.push("_No cohorts._")
  } else {
    const offsets = [
      ...new Set(report.nDayRetention.flatMap((r) => r.cells.map((x) => x.dayOffset))),
    ].sort((a, b) => a - b)
    lines.push(`| Cohort (UTC) | Size | ${offsets.map((o) => `D${o}`).join(" | ")} |`)
    lines.push(`|---|---:|${offsets.map(() => "---:").join("|")}|`)
    for (const row of report.nDayRetention) {
      const cells = row.cells
        .slice()
        .sort((a, b) => a.dayOffset - b.dayOffset)
        .map((cell) => pct(cell.retention))
      lines.push(`| ${row.anchorDay} | ${row.cohortSize} | ${cells.join(" | ")} |`)
    }
  }
  lines.push("")

  lines.push("## Survival curve (pooled)")
  lines.push("")
  lines.push(
    "Share of users old enough to be observed whose last activity is still ≥ N days after first activity.",
  )
  lines.push("")
  lines.push("| Day | Eligible | Retained | Survival |")
  lines.push("|---:|---:|---:|---:|")
  // Sample the curve: every point up to day 14, then weekly.
  for (const p of report.survival) {
    if (p.day <= 14 || p.day % 7 === 0) {
      lines.push(`| ${p.day} | ${p.eligible} | ${p.retained} | ${pct(p.survival)} |`)
    }
  }
  lines.push("")
  if (report.dataSource === "demo") {
    lines.push("> Demo data — deterministic synthetic events. See docs/analytics/retention.md.")
    lines.push("")
  }
  return lines.join("\n")
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    usage()
    return
  }

  const now = new Date()
  let events
  let dataSource
  if (args.file) {
    events = await loadEvents(resolve(repoRoot, args.file))
    dataSource = "events"
  } else {
    events = generateDemoActivityEvents(now)
    dataSource = "demo"
  }

  const report = buildRetentionReport(events, { now, dataSource })

  if (args.json) {
    console.log(JSON.stringify(report, null, 2))
  } else {
    console.log(markdown(report))
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
