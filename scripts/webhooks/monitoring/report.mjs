#!/usr/bin/env node
/**
 * Webhook delivery monitoring report.
 *
 * Analyzes webhook delivery-attempt logs (NDJSON — one JSON object per line)
 * and prints a health summary plus any threshold alerts.
 *
 * Usage:
 *   node scripts/webhooks/monitoring/report.mjs --demo
 *   node scripts/webhooks/monitoring/report.mjs --file deliveries.ndjson
 *   node scripts/webhooks/monitoring/report.mjs --file - < deliveries.ndjson   # stdin
 *   node scripts/webhooks/monitoring/report.mjs --file deliveries.ndjson --json
 *
 * Options:
 *   --demo            Analyze the built-in synthetic corpus (no file needed).
 *   --file <path>     NDJSON log file; use `-` to read stdin.
 *   --json            Emit the raw summary+alerts JSON instead of text.
 *   --min-attempts N  Override the minimum sample before rate alerts fire.
 *   --fail-on-warning Exit 1 on warnings too (default: only critical alerts
 *                     fail the run, suitable for cron/CI gating).
 *
 * Exit codes: 0 = healthy (warnings allowed unless --fail-on-warning),
 *             1 = critical alert or usage error, 2 = unreadable input.
 *
 * Log line fields (aliases accepted): ts|timestamp, eventId|event_id|id,
 * endpoint|url, attempt, status|statusCode, latencyMs|durationMs,
 * error, deadLettered|dlq. See monitoring.ts parseDeliveryAttempt.
 */

import { readFileSync } from "node:fs"

import {
  DEFAULT_THRESHOLDS,
  demoDeliveryAttempts,
  evaluateAlerts,
  parseDeliveryLog,
  sortAttemptsByTs,
  summarizeDeliveries,
} from "./monitoring.ts"

function usage() {
  console.error(
    "Usage: report.mjs (--demo | --file <path|->) [--json] " +
      "[--min-attempts N] [--fail-on-warning]",
  )
  process.exit(1)
}

function parseArgs(argv) {
  const args = {
    demo: false,
    file: null,
    json: false,
    failOnWarning: false,
    minAttempts: null,
  }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === "--demo") args.demo = true
    else if (arg === "--json") args.json = true
    else if (arg === "--fail-on-warning") args.failOnWarning = true
    else if (arg === "--file" && argv[i + 1]) {
      args.file = argv[i + 1]
      i += 1
    } else if (arg === "--min-attempts" && argv[i + 1]) {
      const n = Number.parseInt(argv[i + 1], 10)
      if (!Number.isInteger(n) || n < 1) {
        console.error(`Invalid --min-attempts value: ${argv[i + 1]}`)
        process.exit(1)
      }
      args.minAttempts = n
      i += 1
    } else if (arg === "--help" || arg === "-h") {
      usage()
    } else {
      console.error(`Unknown argument: ${arg}`)
      usage()
    }
  }
  if (args.demo === (args.file !== null)) usage()
  return args
}

function readInput(file) {
  if (file === "-") return readFileSync(0, "utf8")
  return readFileSync(file, "utf8")
}

function fmtMs(value) {
  return value === null ? "n/a" : `${Math.round(value)}ms`
}

function fmtRate(value) {
  return `${(value * 100).toFixed(1)}%`
}

function printTextReport({ summary, alerts, skippedLines, source }) {
  const out = []
  out.push("Webhook delivery monitoring report")
  out.push(`Source: ${source}`)
  if (summary.window.from && summary.window.to) {
    out.push(`Window: ${summary.window.from} → ${summary.window.to}`)
  }
  out.push("")
  out.push(`Attempts:        ${summary.total}`)
  out.push(`  success:       ${summary.success} (${fmtRate(summary.successRate)})`)
  out.push(`  http failure:  ${summary.failure}`)
  out.push(`  transport err: ${summary.error}`)
  out.push(`  unhealthy:     ${fmtRate(summary.unhealthyRate)}`)
  out.push(
    `Latency (n=${summary.latency.samples}): avg ${fmtMs(summary.latency.avgMs)}, ` +
      `p50 ${fmtMs(summary.latency.p50Ms)}, p95 ${fmtMs(summary.latency.p95Ms)}, ` +
      `p99 ${fmtMs(summary.latency.p99Ms)}, max ${fmtMs(summary.latency.maxMs)}`,
  )
  out.push(`Trailing consecutive failures: ${summary.consecutiveFailures}`)
  out.push(`Status codes: ${JSON.stringify(summary.statusCodes)}`)
  if (skippedLines > 0) out.push(`Skipped unparseable lines: ${skippedLines}`)

  if (summary.byEndpoint.length > 0) {
    out.push("")
    out.push("By endpoint:")
    for (const ep of summary.byEndpoint) {
      out.push(
        `  ${ep.endpoint}  n=${ep.total} unhealthy=${fmtRate(ep.unhealthyRate)} ` +
          `p95=${fmtMs(ep.p95LatencyMs)}`,
      )
    }
  }

  out.push("")
  out.push(
    `Dead-lettered: ${summary.deadLetter.attempts} attempt(s) across ` +
      `${summary.deadLetter.events} event(s)`,
  )

  out.push("")
  if (alerts.length === 0) {
    out.push("Alerts: none — all thresholds satisfied.")
  } else {
    out.push(`Alerts (${alerts.length}):`)
    for (const alert of alerts) {
      out.push(`  [${alert.severity.toUpperCase()}] ${alert.rule}: ${alert.message}`)
    }
  }

  console.log(out.join("\n"))
}

function main() {
  const args = parseArgs(process.argv.slice(2))

  const thresholds = { ...DEFAULT_THRESHOLDS }
  if (args.minAttempts !== null) thresholds.minAttempts = args.minAttempts

  let text
  let source
  let attempts
  let skippedLines = 0
  if (args.demo) {
    attempts = demoDeliveryAttempts()
    source = "demo corpus (scripts/webhooks/monitoring/monitoring.ts)"
  } else {
    source = args.file === "-" ? "stdin" : args.file
    try {
      text = readInput(args.file)
    } catch (err) {
      console.error(`Cannot read ${source}: ${err.message}`)
      process.exit(2)
    }
    const parsed = parseDeliveryLog(text)
    attempts = parsed.attempts
    skippedLines = parsed.skippedLines
  }

  attempts = sortAttemptsByTs(attempts)
  const summary = summarizeDeliveries(attempts, thresholds)
  const alerts = evaluateAlerts(summary, thresholds)

  if (args.json) {
    console.log(
      JSON.stringify(
        {
          source,
          summary,
          alerts,
          ...(args.demo ? {} : { skippedLines }),
        },
        null,
        2,
      ),
    )
  } else {
    printTextReport({ summary, alerts, skippedLines, source })
  }

  const critical = alerts.some((a) => a.severity === "critical")
  const warning = alerts.some((a) => a.severity === "warning")
  if (critical || (args.failOnWarning && warning)) process.exit(1)
}

main()
