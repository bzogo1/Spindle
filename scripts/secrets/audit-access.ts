import { readFileSync } from "node:fs"

import {
  defaultSecretAccessLogPath,
  parseSecretAccessLog,
  recordSecretAccess,
  summarizeSecretAccess,
  type SecretAccessSummary,
} from "../../src/lib/secrets/audit"

// Summarises the secret access audit log written by
// src/lib/secrets/audit.ts. Read-only by default; `--emit` appends a
// synthetic "check" event so the pipeline can be exercised locally, and
// `--dry-run` prints the exact JSONL line without writing it.
//
//   npx tsx scripts/secrets/audit-access.ts [--log PATH] [--json] [--top N]
//   npx tsx scripts/secrets/audit-access.ts --emit SESSION_SECRET --dry-run
//
// Exit code is 1 with --fail-on-anomaly when the summary contains anomalies.

const USAGE = `Usage: tsx scripts/secrets/audit-access.ts [options]

Options:
  --log <path>        Audit log file (default: .spindle/secret-access-audit.jsonl)
  --since <iso>       Only include events at or after this ISO-8601 timestamp
  --json              Print the full summary as JSON
  --top <n>           Rows per section in text output (default 10)
  --emit <NAME>       Append a synthetic "check" access event for NAME
  --actor <label>     Actor name for --emit (default "audit-cli")
  --dry-run           With --emit, print the JSONL line instead of writing it
  --fail-on-anomaly   Exit 1 when anomalies are present
  --help              Show this help
`

type CliOptions = {
  log?: string
  since?: string
  json: boolean
  top: number
  emit?: string
  actor: string
  dryRun: boolean
  failOnAnomaly: boolean
  help: boolean
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    json: false,
    top: 10,
    actor: "audit-cli",
    dryRun: false,
    failOnAnomaly: false,
    help: false,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const next = () => {
      const value = argv[index + 1]
      if (value === undefined || value.startsWith("--")) {
        console.error(`${arg} requires a value.`)
        process.exit(2)
      }
      index += 1
      return value
    }

    switch (arg) {
      case "--log":
        options.log = next()
        break
      case "--since":
        options.since = next()
        break
      case "--json":
        options.json = true
        break
      case "--top":
        options.top = Math.max(1, Number.parseInt(next(), 10) || 10)
        break
      case "--emit":
        options.emit = next()
        break
      case "--actor":
        options.actor = next()
        break
      case "--dry-run":
        options.dryRun = true
        break
      case "--fail-on-anomaly":
        options.failOnAnomaly = true
        break
      case "--help":
      case "-h":
        options.help = true
        break
      default:
        console.error(`Unknown option: ${arg}`)
        console.error(USAGE)
        process.exit(2)
    }
  }

  return options
}

function printSummary(summary: SecretAccessSummary, top: number) {
  console.log(`Secret access audit`)
  console.log(`  events:     ${summary.totalEvents}`)
  if (summary.firstTimestamp)
    console.log(`  window:     ${summary.firstTimestamp} → ${summary.lastTimestamp}`)
  console.log("")

  if (summary.bySecret.length > 0) {
    console.log(`Top secrets accessed (of ${summary.bySecret.length}):`)
    for (const entry of summary.bySecret.slice(0, top)) {
      const service = entry.service ? ` [${entry.service}]` : ""
      console.log(
        `  ${entry.secretName.padEnd(28)} ${String(entry.count).padStart(5)}  actors:${String(entry.distinctActors).padStart(3)}  denied:${entry.denied}  last:${entry.lastTimestamp}${service}`,
      )
    }
    console.log("")
  }

  if (summary.byActor.length > 0) {
    console.log(`Top actors:`)
    for (const entry of summary.byActor.slice(0, top)) {
      console.log(
        `  ${entry.actor.padEnd(28)} ${String(entry.count).padStart(5)}  secrets:${String(entry.distinctSecrets).padStart(3)}  denied:${entry.denied}`,
      )
    }
    console.log("")
  }

  if (summary.byDay.length > 0) {
    console.log(`Accesses per day:`)
    for (const entry of summary.byDay.slice(-top)) {
      console.log(`  ${entry.day}  ${entry.count}`)
    }
    console.log("")
  }

  if (summary.anomalies.length > 0) {
    console.log(`Anomalies (${summary.anomalies.length}):`)
    for (const anomaly of summary.anomalies.slice(0, top)) {
      const name = anomaly.secretName ? ` ${anomaly.secretName}` : ""
      console.log(`  ! ${anomaly.type}${name}: ${anomaly.detail}`)
    }
    console.log("")
  } else {
    console.log(`Anomalies: none`)
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2))

  if (options.help) {
    console.log(USAGE)
    return
  }

  const logPath = options.log ?? defaultSecretAccessLogPath()

  if (options.emit) {
    const event = recordSecretAccess(
      {
        actor: { kind: "system", name: options.actor },
        secretName: options.emit,
        action: "check",
        source: "scripts/secrets/audit-access.ts",
        allowed: true,
      },
      { path: logPath, dryRun: options.dryRun },
    )

    if (options.dryRun) {
      console.log(`${JSON.stringify(event)}`)
      console.log("(dry-run: nothing written)")
    } else {
      console.log(`Recorded check access for ${event.secretName} → ${logPath}`)
    }
    return
  }

  let text: string
  try {
    text = readFileSync(logPath, "utf8")
  } catch {
    console.log(`No audit log at ${logPath}.`)
    console.log("Secret access events appear here once entrypoints call recordSecretAccess.")
    console.log(`Emit a test event with: --emit <SECRET_NAME> --dry-run`)
    if (options.failOnAnomaly) process.exitCode = 1
    return
  }

  let events = parseSecretAccessLog(text)

  if (options.since) {
    const since = new Date(options.since)
    if (Number.isNaN(since.getTime())) {
      console.error(`--since must be an ISO-8601 timestamp, got "${options.since}".`)
      process.exit(2)
    }
    events = events.filter((event) => event.timestamp >= since.toISOString())
  }

  const summary = summarizeSecretAccess(events)

  if (options.json) {
    console.log(JSON.stringify(summary, null, 2))
  } else {
    console.log(`Log: ${logPath}`)
    console.log("")
    printSummary(summary, options.top)
  }

  if (options.failOnAnomaly && summary.anomalies.length > 0) {
    process.exitCode = 1
  }
}

main()
