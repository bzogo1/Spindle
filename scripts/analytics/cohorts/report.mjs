#!/usr/bin/env node
/**
 * Cohort retention report — acquisition cohorts × weekly activity retention.
 *
 * Reads signup rows, timestamped activity events, or pre-aggregated
 * `weeklyActivity` users from JSONL / JSON input (or built-in demo data),
 * groups users by signup week (Monday UTC), and renders the % of each cohort
 * still active in each subsequent week.
 *
 * Input record shapes (see classifyRecord in cohort-core.mjs):
 *   signup:     { "type": "signup", "userId": "u1", "at": "<iso>" }
 *               { "id": "u1", "created_at": "<iso>", ... }        (users-table export)
 *   activity:   { "type": "activity", "userId": "u1", "at": "<iso>", "count": 2 }
 *               { "user_id": "u1", "occurred_at": "<iso>", "event_name": "page_view" }
 *   pre-agg:    { "id": "u1", "signedUpAt": "<iso>", "weeklyActivity": [3,1,0] }
 *               weeklyActivity may also be an object: { "0": 3, "2": 1 }
 *
 * JSON files may be a top-level array of records, or an object wrapping them
 * under "records" / "users" / "signups" / "events" / "rows".
 *
 * Usage:
 *   node scripts/analytics/cohorts/report.mjs --demo
 *   node scripts/analytics/cohorts/report.mjs --file exports/events.jsonl
 *   node scripts/analytics/cohorts/report.mjs --file export.json --json
 *   node scripts/analytics/cohorts/report.mjs --stdin --markdown > report.md
 *   node scripts/analytics/cohorts/report.mjs --demo --format text,json,markdown
 *
 * Options:
 *   --demo                  use built-in synthetic data (deterministic)
 *   --file <path>           read a file ('-' reads stdin)
 *   --stdin                 read JSONL/JSON from stdin
 *   --json                  shorthand for --format json
 *   --markdown              shorthand for --format markdown
 *   --format <list>         comma-separated: text,json,markdown (default: text)
 *   --weeks <n>             weekly columns W0..W{n-1} (default: 8)
 *   --max-cohorts <n>       most recent cohorts shown (default: 12)
 *   --now <iso>             reference time for complete-week checks (tests)
 *   --help, -h              show this message
 *
 * Exit codes: 0 ok, 2 usage error.
 */

import { readFile } from "node:fs/promises"
import { resolve } from "node:path"

import {
  analyzeRecords,
  formatMarkdownReport,
  formatTextReport,
  generateDemoRecords,
} from "./cohort-core.mjs"

const HELP = `cohort report — acquisition-cohort retention matrix

Sources (pick one):
  --demo               built-in synthetic signup/activity records
  --file <path>        JSONL or JSON file ('-' reads stdin)
  --stdin              read JSONL/JSON from stdin

Output:
  --format <list>      comma-separated: text,json,markdown (default: text)
  --json               shorthand for --format json
  --markdown           shorthand for --format markdown

Options:
  --weeks <n>          weekly columns (default: 8)
  --max-cohorts <n>    most recent cohorts shown (default: 12)
  --now <iso>          reference time (default: current time)
  --help, -h           show this message

Exit codes: 0 ok, 2 usage error.`

function parseArgs(argv) {
  const options = {
    help: false,
    demo: false,
    stdin: false,
    file: null,
    format: null,
    json: false,
    markdown: false,
    weeks: 8,
    maxCohorts: 12,
    now: null,
    error: false,
  }
  const int = (raw, name) => {
    const n = Number.parseInt(raw, 10)
    if (!Number.isFinite(n) || n <= 0) {
      console.error(`[cohorts] --${name} expects a positive integer`)
      options.error = true
      return 0
    }
    return n
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
      case "--stdin":
        options.stdin = true
        break
      case "--file":
        options.file = next() ?? null
        break
      case "--format":
        options.format = next() ?? null
        break
      case "--json":
        options.json = true
        break
      case "--markdown":
        options.markdown = true
        break
      case "--weeks":
        options.weeks = int(next(), "weeks")
        break
      case "--max-cohorts":
        options.maxCohorts = int(next(), "max-cohorts")
        break
      case "--now":
        options.now = next() ?? null
        break
      default:
        if (arg.startsWith("--")) {
          console.error(`[cohorts] unknown option "${arg}"`)
          options.error = true
        }
    }
  }
  return options
}

// ---------------------------------------------------------------------------
// Input loading — JSON array/object or newline-delimited JSON records.
// ---------------------------------------------------------------------------

const WRAPPER_KEYS = ["records", "users", "signups", "events", "activity", "rows", "data"]

function flattenPayload(payload) {
  if (Array.isArray(payload)) return payload
  if (payload && typeof payload === "object") {
    const records = []
    for (const key of WRAPPER_KEYS) {
      if (Array.isArray(payload[key])) records.push(...payload[key])
    }
    if (records.length > 0) return records
    // Single record object.
    return [payload]
  }
  return []
}

function parseJsonl(text) {
  const records = []
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      records.push(JSON.parse(trimmed))
    } catch {
      console.error(`[cohorts] skipping malformed JSONL line: ${trimmed.slice(0, 80)}`)
    }
  }
  return records
}

async function loadRecords(options) {
  let text
  let source
  if (options.demo) {
    return {
      records: generateDemoRecords({
        weeks: options.weeks,
        ...(options.now ? { now: options.now } : {}),
      }),
      source: "demo",
    }
  }
  if (options.file && options.file !== "-") {
    text = await readFile(resolve(options.file), "utf8")
    source = options.file
  } else {
    const chunks = []
    for await (const chunk of process.stdin) chunks.push(String(chunk))
    text = chunks.join("")
    source = "stdin"
  }
  const trimmed = text.trim()
  if (!trimmed) return { records: [], source }
  // Whole-file JSON first; fall back to JSONL.
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    try {
      return { records: flattenPayload(JSON.parse(trimmed)), source }
    } catch {
      // fall through to JSONL
    }
  }
  return { records: parseJsonl(text), source }
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
  if (options.error) return 2

  if (!options.demo && !options.file && !options.stdin) {
    console.error("[cohorts] specify --demo, --file <path>, or --stdin")
    return 2
  }

  let formats
  if (options.format) {
    formats = options.format.split(",")
  } else if (options.json || options.markdown) {
    formats = [...(options.json ? ["json"] : []), ...(options.markdown ? ["markdown"] : [])]
  } else {
    formats = ["text"]
  }
  formats = formats.map((f) => f.trim()).filter(Boolean)
  const valid = new Set(["text", "json", "markdown"])
  for (const f of formats) {
    if (!valid.has(f)) {
      console.error(`[cohorts] unknown format "${f}"`)
      return 2
    }
  }

  const { records, source } = await loadRecords(options)
  const analysisOptions = {
    weeks: options.weeks,
    maxCohorts: options.maxCohorts,
    ...(options.now ? { now: options.now } : {}),
  }
  const report = analyzeRecords(records, analysisOptions)
  report.dataSource = source === "demo" ? "demo" : source

  const out = []
  for (const format of formats) {
    if (format === "json") out.push(JSON.stringify(report, null, 2))
    else if (format === "markdown") out.push(formatMarkdownReport(report))
    else out.push(formatTextReport(report))
  }
  console.log(out.join("\n\n"))
  return 0
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(`[cohorts] ${err?.message ?? err}`)
    process.exit(2)
  },
)
