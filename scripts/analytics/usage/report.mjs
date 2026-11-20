#!/usr/bin/env node
/**
 * Feature-usage report.
 *
 * Reads a JSONL stream of feature-usage events (shape documented in
 * docs/analytics/feature-usage.md; produced by src/lib/usage and the sinks
 * described there) and emits per-feature usage counts, unique subjects,
 * adoption rates, and DAU-per-feature as Markdown and/or JSON.
 *
 * Usage:
 *   node scripts/analytics/usage/report.mjs [options]
 *
 * Options:
 *   --file <path>      JSONL events file (default: data/usage/events.jsonl)
 *   --demo             Generate synthetic demo events and report on them
 *   --format <fmt>     md | json | both        (default: md)
 *   --json             Shorthand for --format json
 *   --total-subjects <n>  Adoption denominator; default = distinct subjects
 *                       seen in the stream
 *   --out-md <path>    Also write the markdown report to a file
 *   --out-json <path>  Also write the JSON report to a file
 *   -h, --help         Show this help
 *
 * Blank lines, malformed JSON, and non-"feature_use" lines are skipped, so
 * partial writes and mixed log files are tolerated. Aggregation mirrors the
 * pure functions in src/lib/usage/aggregate.ts — keep them in sync.
 */

import { readFileSync, writeFileSync } from "node:fs"

const DEFAULT_FILE = "data/usage/events.jsonl"
const DAY_MS = 24 * 60 * 60 * 1000

// --- args -------------------------------------------------------------------

function parseArgs(argv) {
  const args = {
    file: DEFAULT_FILE,
    demo: false,
    format: "md",
    totalSubjects: null,
    outMd: null,
    outJson: null,
    help: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const next = () => argv[++i]
    switch (arg) {
      case "--file":
      case "--input": // alias, consistent with scripts/feature-flags/report.mjs
        args.file = next()
        break
      case "--demo":
        args.demo = true
        break
      case "--format":
        args.format = next()
        break
      case "--json":
        args.format = "json"
        break
      case "--total-subjects": {
        const n = Number(next())
        if (!Number.isFinite(n) || n < 0) {
          console.error(`Invalid --total-subjects value`)
          process.exit(2)
        }
        args.totalSubjects = n
        break
      }
      case "--out-md":
        args.outMd = next()
        break
      case "--out-json":
        args.outJson = next()
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
  if (!["md", "json", "both"].includes(args.format)) {
    console.error(`Invalid --format "${args.format}" (expected md | json | both)`)
    process.exit(2)
  }
  return args
}

// --- event parsing (mirrors src/lib/usage/events.ts) ------------------------

const MAX_FEATURE_KEY_LENGTH = 128
const MAX_SUBJECT_LENGTH = 128

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function validSubject(subject) {
  return (
    typeof subject === "string" &&
    subject.length > 0 &&
    subject.length <= MAX_SUBJECT_LENGTH &&
    (subject.startsWith("user:") || subject.startsWith("anon:") || subject.startsWith("mock:"))
  )
}

function validFeature(feature) {
  return (
    typeof feature === "string" &&
    feature.length > 0 &&
    feature.length <= MAX_FEATURE_KEY_LENGTH &&
    !/\s/.test(feature)
  )
}

/**
 * Accepts the canonical `{kind:"feature_use", feature, subject, timestamp}`
 * shape and the flattened `/api/analytics` ingest shape
 * (`type:"feature_use"`, `feature`, `anonymousId`/`userId`, `props`).
 */
function parseEvent(raw) {
  if (!isPlainObject(raw)) return null
  const kind = raw.kind ?? raw.type
  if (kind !== "feature_use") return null

  let subject = raw.subject ?? raw.anonymousId ?? raw.userId
  if (typeof subject === "string" && subject.length > 0 && !subject.includes(":")) {
    subject = `anon:${subject}`
  }
  const timestamp = raw.timestamp ?? raw.receivedAt
  if (typeof timestamp !== "number" || !Number.isFinite(timestamp)) return null
  if (!validFeature(raw.feature) || !validSubject(subject)) return null

  const event = { kind: "feature_use", feature: raw.feature, subject, timestamp }
  const properties =
    raw.properties !== undefined && raw.properties !== null
      ? raw.properties
      : raw.props !== undefined && raw.props !== null
        ? raw.props
        : undefined
  if (properties !== undefined) {
    if (!isPlainObject(properties)) return null
    event.properties = properties
  }
  return event
}

function parseJsonl(text) {
  const events = []
  let skipped = 0
  for (const line of text.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed) continue
    let raw
    try {
      raw = JSON.parse(trimmed)
    } catch {
      skipped += 1
      continue
    }
    const event = parseEvent(raw)
    if (event) events.push(event)
    else skipped += 1
  }
  return { events, skipped }
}

// --- aggregation (mirrors src/lib/usage/aggregate.ts) -----------------------

function utcDayKey(timestamp) {
  return new Date(timestamp).toISOString().slice(0, 10)
}

function countFeatureUsage(events) {
  const byFeature = new Map()
  for (const event of events) {
    let entry = byFeature.get(event.feature)
    if (!entry) {
      entry = { events: 0, subjects: new Set() }
      byFeature.set(event.feature, entry)
    }
    entry.events += 1
    entry.subjects.add(event.subject)
  }
  return [...byFeature.entries()]
    .map(([feature, e]) => ({ feature, events: e.events, uniqueSubjects: e.subjects.size }))
    .sort(
      (a, b) =>
        b.uniqueSubjects - a.uniqueSubjects ||
        b.events - a.events ||
        a.feature.localeCompare(b.feature),
    )
}

function computeAdoption(events, totalSubjects) {
  const denominator =
    totalSubjects !== null && totalSubjects !== undefined
      ? Math.max(0, totalSubjects)
      : new Set(events.map((e) => e.subject)).size
  return countFeatureUsage(events).map((c) => ({
    ...c,
    adoption: denominator > 0 ? c.uniqueSubjects / denominator : 0,
  }))
}

function computeDailyActiveUsers(events) {
  const byDayFeature = new Map()
  for (const event of events) {
    const date = utcDayKey(event.timestamp)
    const key = JSON.stringify([date, event.feature])
    let entry = byDayFeature.get(key)
    if (!entry) {
      entry = { date, feature: event.feature, subjects: new Set(), events: 0 }
      byDayFeature.set(key, entry)
    }
    entry.events += 1
    entry.subjects.add(event.subject)
  }
  return [...byDayFeature.values()]
    .map((e) => ({
      date: e.date,
      feature: e.feature,
      activeSubjects: e.subjects.size,
      events: e.events,
    }))
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        b.activeSubjects - a.activeSubjects ||
        a.feature.localeCompare(b.feature),
    )
}

function buildReport(events, totalSubjects) {
  const allSubjects = new Set(events.map((e) => e.subject))
  const allFeatures = new Set(events.map((e) => e.feature))
  return {
    generatedAt: new Date().toISOString(),
    totals: {
      events: events.length,
      uniqueSubjects: allSubjects.size,
      features: allFeatures.size,
    },
    adoptionDenominator: totalSubjects ?? allSubjects.size,
    byFeature: computeAdoption(events, totalSubjects),
    dailyActiveUsers: computeDailyActiveUsers(events),
  }
}

// --- demo data ---------------------------------------------------------------

/** Deterministic synthetic stream: 3 features x 3 UTC days. */
function demoEvents() {
  const features = ["new-dashboard", "docs-search-v2", "realtime-collab"]
  const subjects = [
    ...Array.from({ length: 8 }, (_, i) => `user:demo-u${i + 1}`),
    ...Array.from({ length: 4 }, (_, i) => `anon:demo-a${i + 1}`),
  ]
  const now = Date.UTC(
    new Date().getUTCFullYear(),
    new Date().getUTCMonth(),
    new Date().getUTCDate(),
  )
  const events = []
  // Deterministic LCG so --demo output is stable day to day.
  let seed = 42
  const rand = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648
    return seed / 2147483648
  }
  for (let dayOffset = 2; dayOffset >= 0; dayOffset--) {
    const dayStart = now - dayOffset * DAY_MS
    for (const feature of features) {
      // Each feature has a different "popularity" profile.
      const popularity = { "new-dashboard": 0.9, "docs-search-v2": 0.4, "realtime-collab": 0.6 }[
        feature
      ]
      for (const subject of subjects) {
        if (rand() < popularity * (1 - dayOffset * 0.15)) {
          const count = 1 + Math.floor(rand() * 3)
          for (let k = 0; k < count; k++) {
            events.push({
              kind: "feature_use",
              feature,
              subject,
              timestamp: dayStart + Math.floor(rand() * DAY_MS),
              properties: { demo: true },
            })
          }
        }
      }
    }
  }
  return events
}

// --- rendering ----------------------------------------------------------------

function pct(value) {
  return `${(value * 100).toFixed(1)}%`
}

function renderMarkdown(report) {
  const lines = []
  lines.push("# Feature usage report", "")
  lines.push(`Generated: ${report.generatedAt}`, "")
  lines.push("## Totals", "")
  lines.push(`- Events: **${report.totals.events}**`)
  lines.push(`- Unique subjects: **${report.totals.uniqueSubjects}**`)
  lines.push(`- Features used: **${report.totals.features}**`)
  lines.push(`- Adoption denominator: ${report.adoptionDenominator} subjects`, "")

  lines.push("## Usage by feature", "")
  lines.push("| Feature | Events | Unique subjects | Adoption |")
  lines.push("| --- | ---: | ---: | ---: |")
  for (const row of report.byFeature) {
    lines.push(
      `| \`${row.feature}\` | ${row.events} | ${row.uniqueSubjects} | ${pct(row.adoption)} |`,
    )
  }
  lines.push("")

  lines.push("## DAU per feature (UTC days)", "")
  lines.push("| Date | Feature | Active subjects | Events |")
  lines.push("| --- | --- | ---: | ---: |")
  for (const row of report.dailyActiveUsers) {
    lines.push(`| ${row.date} | \`${row.feature}\` | ${row.activeSubjects} | ${row.events} |`)
  }
  lines.push("")
  return lines.join("\n")
}

// --- main ---------------------------------------------------------------------

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log(
      "Usage: node scripts/analytics/usage/report.mjs [--file <path>] [--demo] [--format md|json|both] [--json] [--total-subjects <n>] [--out-md <path>] [--out-json <path>]",
    )
    return
  }

  let events
  let skipped = 0
  if (args.demo) {
    events = demoEvents()
  } else {
    let text
    try {
      text = readFileSync(args.file, "utf8")
    } catch (err) {
      console.error(`Cannot read ${args.file}: ${err.message}`)
      process.exit(1)
    }
    const parsed = parseJsonl(text)
    events = parsed.events
    skipped = parsed.skipped
  }

  const report = buildReport(events, args.totalSubjects)
  report.skippedLines = skipped

  const markdown = renderMarkdown(report)
  const json = JSON.stringify(report, null, 2)

  if (args.format === "md" || args.format === "both") {
    if (args.outMd) {
      writeFileSync(args.outMd, markdown)
      console.error(`Wrote markdown report to ${args.outMd}`)
    } else {
      process.stdout.write(markdown)
    }
  }
  if (args.format === "json" || args.format === "both") {
    if (args.outJson) {
      writeFileSync(args.outJson, json)
      console.error(`Wrote JSON report to ${args.outJson}`)
    } else {
      process.stdout.write(`${json}\n`)
    }
  }
  if (skipped > 0) {
    console.error(`Skipped ${skipped} malformed/non-feature_use line(s).`)
  }
}

main()
