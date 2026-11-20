#!/usr/bin/env node
/**
 * Funnel analysis report.
 *
 * Reads product-analytics events (JSONL — one event object per line, or
 * `{ "events": [...] }` batches as POSTed to /api/analytics) and computes
 * ordered funnel reports using src/lib/funnel (conversion between steps,
 * drop-off, time-in-step). With no input it uses --demo synthetic events.
 *
 * The funnel engine is imported straight from TypeScript source — Node ≥22.18
 * strips types natively, so plain `node` works; no build step needed. Keep
 * src/lib/funnel/index.ts import-free and erasable-TS-only.
 *
 * Usage:
 *   node scripts/analytics/funnel/report.mjs --demo
 *   node scripts/analytics/funnel/report.mjs --file events.jsonl
 *   node scripts/analytics/funnel/report.mjs --stdin --funnel signup_activation
 *   node scripts/analytics/funnel/report.mjs --demo --format json
 *
 * Options:
 *   --demo                  Generate deterministic synthetic events (default
 *                           source when neither --file nor --stdin is given)
 *   --file <path>           Read JSONL events from a file ('-' = stdin)
 *   --stdin                 Read JSONL events from stdin
 *   --funnel <id|all>       Funnel id from the catalog, or 'all' (default: all)
 *   --format <list>         Comma-separated: text,json (default: text)
 *   -h, --help              Show this help
 *
 * Event line shape (fields used): name, type, path, feature, endpoint, props,
 * timestamp (epoch ms), actorId | anonymousId | props.anonymousId.
 *
 * Exit codes: 0 ok, 2 usage error.
 */

import { readFile } from "node:fs/promises"
import readline from "node:readline"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"

import {
  FUNNELS,
  analyzeFunnels,
  generateDemoFunnelEvents,
  getFunnel,
} from "../../../src/lib/funnel/index.ts"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, "../../..")

const HELP = `funnel report — ordered step conversion over analytics events

Sources (pick one, default --demo):
  --demo               synthetic events covering every catalog funnel
  --file <path>        JSONL events file ('-' reads stdin)
  --stdin              read JSONL events from stdin

Options:
  --funnel <id|all>    funnel id or 'all' (default: all)
  --format <list>      comma-separated: text,json (default: text)
  -h, --help           show this help

Funnels: ${FUNNELS.map((f) => f.id).join(", ")}
`

function parseArgs(argv) {
  const args = { demo: false, file: null, stdin: false, funnel: "all", format: "text", help: false }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const next = () => argv[++i]
    switch (arg) {
      case "--demo":
        args.demo = true
        break
      case "--file":
        args.file = next()
        break
      case "--stdin":
        args.stdin = true
        break
      case "--funnel":
        args.funnel = next()
        break
      case "--format":
        args.format = next()
        break
      case "-h":
      case "--help":
        args.help = true
        break
      default:
        console.error(`Unknown argument: ${arg}`)
        process.exit(2)
    }
  }
  return args
}

/** Parses one JSONL line into 0+ funnel events (accepts {events:[...]} too). */
function parseLine(line, sink, lineNo) {
  const trimmed = line.trim()
  if (!trimmed) return
  let parsed
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    console.error(`Skipping malformed JSON on line ${lineNo}`)
    return
  }
  const items = Array.isArray(parsed?.events) ? parsed.events : [parsed]
  for (const item of items) {
    if (item && typeof item === "object" && typeof item.name === "string") {
      sink.push(item)
    }
  }
}

async function readEvents(args) {
  if (args.demo) return generateDemoFunnelEvents()

  const events = []
  if (args.file) {
    if (args.file === "-") {
      const rl = readline.createInterface({ input: process.stdin })
      let lineNo = 0
      for await (const line of rl) {
        lineNo += 1
        parseLine(line, events, lineNo)
      }
    } else {
      const path = resolve(repoRoot, args.file)
      const content = await readFile(path, "utf8")
      content.split("\n").forEach((line, idx) => parseLine(line, events, idx + 1))
    }
    return events
  }

  if (args.stdin) {
    const rl = readline.createInterface({ input: process.stdin })
    let lineNo = 0
    for await (const line of rl) {
      lineNo += 1
      parseLine(line, events, lineNo)
    }
    return events
  }

  // No explicit source → demo.
  return generateDemoFunnelEvents()
}

function pct(value) {
  return value === null || value === undefined ? "  —  " : `${(value * 100).toFixed(1)}%`
}

function fmtMs(value) {
  if (value === null || value === undefined) return "—"
  if (value < 60_000) return `${Math.round(value / 1000)}s`
  if (value < 3_600_000) return `${(value / 60_000).toFixed(1)}m`
  if (value < 86_400_000) return `${(value / 3_600_000).toFixed(1)}h`
  return `${(value / 86_400_000).toFixed(1)}d`
}

function renderText(reports, meta) {
  const lines = []
  lines.push(`Funnel report — ${meta.eventCount} events, ${meta.actorEvents} attributed`)
  lines.push(`Generated: ${new Date(meta.now).toISOString()}\n`)
  for (const report of reports) {
    lines.push(`■ ${report.funnelName}  (${report.funnelId})`)
    if (report.windowMs !== null) {
      lines.push(`  window: ${fmtMs(report.windowMs)} · actors: ${report.totalActors}`)
    } else {
      lines.push(`  actors: ${report.totalActors}`)
    }
    // Simple aligned table.
    const header = ["step", "reached", "convPrev", "convTop", "drop", "medT+", "avgT+"]
    lines.push(`  ${header.join("\t")}`)
    report.steps.forEach((step, i) => {
      const cells = [
        `${i + 1}. ${step.label}`,
        String(step.reached),
        pct(step.conversionFromPrevious),
        pct(step.conversionFromTop),
        step.dropOff === null ? "—" : String(step.dropOff),
        fmtMs(step.medianTimeToNextMs),
        fmtMs(step.avgTimeToNextMs),
      ]
      lines.push(`  ${cells.join("\t")}`)
    })
    lines.push(`  overall conversion: ${pct(report.overallConversion)}`)
    if (report.skippedEvents > 0) {
      lines.push(`  note: ${report.skippedEvents} unattributed events skipped`)
    }
    lines.push("")
  }
  return lines.join("\n")
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    process.stdout.write(HELP)
    return
  }

  const formats = args.format
    .split(",")
    .map((f) => f.trim())
    .filter(Boolean)
  for (const f of formats) {
    if (!["text", "json"].includes(f)) {
      console.error(`Unknown format: ${f} (expected text,json)`)
      process.exit(2)
    }
  }

  const funnels = args.funnel === "all" ? FUNNELS : [getFunnel(args.funnel)].filter(Boolean)
  if (funnels.length === 0) {
    console.error(
      `Unknown funnel '${args.funnel}'. Known: ${FUNNELS.map((f) => f.id).join(", ")}, all`,
    )
    process.exit(2)
  }

  const events = await readEvents(args)
  const now = Date.now()
  const reports = analyzeFunnels(events, funnels, { now })
  const meta = { eventCount: events.length, actorEvents: events.length, now }

  if (formats.includes("json")) {
    process.stdout.write(
      JSON.stringify({ generatedAt: new Date(now).toISOString(), reports }, null, 2) + "\n",
    )
  }
  if (formats.includes("text")) {
    process.stdout.write(renderText(reports, meta))
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
