#!/usr/bin/env node
/**
 * Feature-flag analytics report.
 *
 * Reads JSONL flag-exposure events (see src/lib/feature-flags/analytics and
 * docs/feature-flags/analytics.md) and produces exposure counts, variant
 * distribution, unique-subject counts, and actual-vs-configured rollout
 * percentages as Markdown and/or JSON.
 *
 * Usage:
 *   node scripts/feature-flags/report.mjs [options]
 *
 * Options:
 *   --input <path>     JSONL events file (default: data/feature-flags/events.jsonl)
 *   --config <path>    Flag configuration JSON (see FORMAT below)
 *   --demo             Generate synthetic demo events, run the report, exit
 *   --format <fmt>     md | json | both   (default: md)
 *   --out-md <path>    Also write the markdown report to a file
 *   --out-json <path>  Also write the JSON report to a file
 *   -h, --help         Show this help
 *
 * Config format (all fields optional per flag):
 *   {
 *     "flags": {
 *       "new-dashboard": { "type": "rollout", "rolloutPercent": 25, "variant": "on" },
 *       "checkout-flow": { "type": "multivariate",
 *                          "variants": { "control": 60, "treatment": 40 } }
 *     }
 *   }
 * A top-level map without the "flags" wrapper is also accepted.
 *
 * Rollout actuals: share of unique subjects whose latest assignment equals the
 * configured `variant` (default "on"). Multivariate actuals: share of unique
 * subjects per variant vs configured weights.
 */

import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const DEFAULT_INPUT = "data/feature-flags/events.jsonl"

// --- args -------------------------------------------------------------------

function parseArgs(argv) {
  const args = {
    input: DEFAULT_INPUT,
    config: null,
    demo: false,
    format: "md",
    outMd: null,
    outJson: null,
    help: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const next = () => argv[++i]
    switch (arg) {
      case "--input":
        args.input = next()
        break
      case "--config":
        args.config = next()
        break
      case "--demo":
        args.demo = true
        break
      case "--format":
        args.format = next()
        break
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
        if (arg.startsWith("--")) {
          console.error(`Unknown option: ${arg}`)
          process.exit(2)
        }
    }
  }
  if (!["md", "json", "both"].includes(args.format)) {
    console.error(`Invalid --format "${args.format}" (expected md|json|both)`)
    process.exit(2)
  }
  return args
}

// --- hashing (mirrors src/lib/feature-flags/analytics/bucket.ts) -----------

function cyrb53(input, seed = 0) {
  let h1 = 0xdeadbeef ^ seed
  let h2 = 0x41c6ce57 ^ seed
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return 4294967296 * (2097151 & h2) + (h1 >>> 0)
}

const bucketIndex = (flag, userKey, count = 100) =>
  cyrb53(`${flag}\n${userKey}`) % Math.max(1, Math.floor(count))

// --- loading ----------------------------------------------------------------

function loadEvents(path) {
  const raw = readFileSync(path, "utf8")
  const events = []
  let skipped = 0
  for (const [index, line] of raw.split("\n").entries()) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const parsed = JSON.parse(trimmed)
      if (parsed && parsed.event === "flag_exposure") events.push(parsed)
      else skipped++
    } catch {
      console.error(`Skipping malformed JSONL line ${index + 1} in ${path}`)
      skipped++
    }
  }
  return { events, skipped }
}

function loadConfig(path) {
  if (!path) return { flags: {} }
  const parsed = JSON.parse(readFileSync(path, "utf8"))
  const flags = parsed.flags ?? parsed
  return { flags: flags && typeof flags === "object" ? flags : {} }
}

// --- aggregation ------------------------------------------------------------

function assignmentOf(event) {
  if (typeof event.variant === "string" && event.variant.length > 0) return event.variant
  if (event.value === true) return "true"
  if (event.value === false) return "false"
  if (event.value === null || event.value === undefined) return "(none)"
  return String(event.value)
}

function aggregate(events) {
  const byFlag = new Map()
  for (const event of events) {
    const flag = typeof event.flag === "string" ? event.flag : "(unknown)"
    if (!byFlag.has(flag)) {
      byFlag.set(flag, {
        flag,
        events: 0,
        kinds: { exposure: 0, evaluation: 0 },
        subjects: new Set(),
        assignments: new Map(), // assignment -> { events, subjects:Set }
        lastBySubject: new Map(), // subjectHash -> { assignment, timestamp, order }
        firstSeen: null,
        lastSeen: null,
        environments: new Set(),
      })
    }
    const stats = byFlag.get(flag)
    stats.events++
    stats.kinds[event.kind === "evaluation" ? "evaluation" : "exposure"]++
    if (event.subjectHash) stats.subjects.add(event.subjectHash)
    if (event.environment) stats.environments.add(event.environment)

    const assignment = assignmentOf(event)
    if (!stats.assignments.has(assignment)) {
      stats.assignments.set(assignment, { events: 0, subjects: new Set() })
    }
    const a = stats.assignments.get(assignment)
    a.events++
    if (event.subjectHash) a.subjects.add(event.subjectHash)

    if (event.subjectHash) {
      const ts = typeof event.timestamp === "string" ? event.timestamp : ""
      const prev = stats.lastBySubject.get(event.subjectHash)
      // Latest timestamp wins; ties keep the later line (monotonic order).
      if (!prev || ts >= prev.timestamp) {
        stats.lastBySubject.set(event.subjectHash, { assignment, timestamp: ts })
      }
    }

    const ts = typeof event.timestamp === "string" ? event.timestamp : ""
    if (ts) {
      if (!stats.firstSeen || ts < stats.firstSeen) stats.firstSeen = ts
      if (!stats.lastSeen || ts > stats.lastSeen) stats.lastSeen = ts
    }
  }

  const flags = [...byFlag.values()].map((stats) => {
    const subjectCount = stats.subjects.size
    const shares = new Map()
    for (const { assignment } of stats.lastBySubject.values()) {
      shares.set(assignment, (shares.get(assignment) ?? 0) + 1)
    }
    return {
      flag: stats.flag,
      events: stats.events,
      exposures: stats.kinds.exposure,
      evaluations: stats.kinds.evaluation,
      uniqueSubjects: subjectCount,
      environments: [...stats.environments].sort(),
      firstSeen: stats.firstSeen,
      lastSeen: stats.lastSeen,
      assignments: [...stats.assignments.entries()]
        .map(([assignment, a]) => ({
          assignment,
          events: a.events,
          uniqueSubjects: a.subjects.size,
          subjectShare: subjectCount ? a.subjects.size / subjectCount : 0,
        }))
        .sort((x, y) => y.events - x.events),
      // Share of unique subjects whose *latest* assignment is each variant —
      // the number rollout comparisons should use.
      latestShares: [...shares.entries()]
        .map(([assignment, count]) => ({
          assignment,
          subjects: count,
          share: subjectCount ? count / subjectCount : 0,
        }))
        .sort((x, y) => y.subjects - x.subjects),
    }
  })

  flags.sort((a, b) => b.events - a.events)
  return flags
}

function compareWithConfig(flagStats, flagConfig) {
  if (!flagConfig || typeof flagConfig !== "object") return null

  const latestShare = (name) =>
    flagStats.latestShares.find((s) => s.assignment === name)?.share ?? 0

  if (
    flagConfig.type === "rollout" ||
    (flagConfig.rolloutPercent !== undefined && !flagConfig.variants)
  ) {
    const configuredVariant = flagConfig.variant ?? "on"
    const configuredPercent = Number(flagConfig.rolloutPercent)
    if (!Number.isFinite(configuredPercent)) return null
    const actualPercent = latestShare(configuredVariant) * 100
    return {
      type: "rollout",
      variant: configuredVariant,
      configuredPercent,
      actualPercent,
      deltaPoints: actualPercent - configuredPercent,
    }
  }

  if (flagConfig.variants && typeof flagConfig.variants === "object") {
    const rows = Object.entries(flagConfig.variants).map(([variant, weight]) => ({
      variant,
      configuredPercent: Number(weight),
      actualPercent: latestShare(variant) * 100,
    }))
    for (const row of rows) row.deltaPoints = row.actualPercent - row.configuredPercent
    const unexpected = flagStats.latestShares
      .map((s) => s.assignment)
      .filter((a) => !(a in flagConfig.variants))
    return {
      type: "multivariate",
      variants: rows,
      unexpectedVariants: unexpected,
    }
  }

  return null
}

function buildReport(events, skipped, inputPath, config) {
  const flagStats = aggregate(events)
  const flags = flagStats.map((stats) => ({
    ...stats,
    config: compareWithConfig(stats, config.flags?.[stats.flag]),
  }))
  const totalSubjects = new Set(events.map((e) => e.subjectHash).filter(Boolean)).size
  return {
    generatedAt: new Date().toISOString(),
    input: inputPath,
    totals: {
      events: events.length,
      skippedLines: skipped,
      flags: flags.length,
      uniqueSubjects: totalSubjects,
    },
    flags,
  }
}

// --- rendering --------------------------------------------------------------

const pct = (fraction) => `${(fraction * 100).toFixed(1)}%`
const pts = (n) => `${n >= 0 ? "+" : ""}${n.toFixed(1)}`

function renderMarkdown(report) {
  const lines = []
  lines.push("# Feature flag analytics report")
  lines.push("")
  lines.push(`- Input: \`${report.input}\``)
  lines.push(`- Generated: ${report.generatedAt}`)
  lines.push(
    `- Events: ${report.totals.events} (${report.totals.skippedLines} skipped lines), ` +
      `${report.totals.flags} flags, ${report.totals.uniqueSubjects} unique subjects`,
  )
  lines.push("")

  if (report.flags.length === 0) {
    lines.push("_No flag exposure events found._")
    return lines.join("\n")
  }

  lines.push("## Summary")
  lines.push("")
  lines.push("| Flag | Events | Subjects | Assignments | Rollout actual vs configured |")
  lines.push("| --- | ---: | ---: | --- | --- |")
  for (const flag of report.flags) {
    const assignments = flag.assignments.map((a) => a.assignment).join(", ")
    let comparison = "—"
    if (flag.config?.type === "rollout") {
      comparison =
        `${pct(flag.config.actualPercent / 100)} actual vs ` +
        `${flag.config.configuredPercent}% configured (${pts(flag.config.deltaPoints)} pts)`
    } else if (flag.config?.type === "multivariate") {
      const worst = flag.config.variants.reduce(
        (max, v) => (Math.abs(v.deltaPoints) > Math.abs(max.deltaPoints) ? v : max),
        flag.config.variants[0] ?? { deltaPoints: 0 },
      )
      comparison = `max deviation ${pts(worst.deltaPoints)} pts`
    }
    lines.push(
      `| \`${flag.flag}\` | ${flag.events} | ${flag.uniqueSubjects} | ${assignments} | ${comparison} |`,
    )
  }
  lines.push("")

  for (const flag of report.flags) {
    lines.push(`## \`${flag.flag}\``)
    lines.push("")
    lines.push(
      `- Events: ${flag.events} (exposures: ${flag.exposures}, evaluations: ${flag.evaluations})`,
    )
    lines.push(`- Unique subjects: ${flag.uniqueSubjects}`)
    if (flag.environments.length) lines.push(`- Environments: ${flag.environments.join(", ")}`)
    if (flag.firstSeen) lines.push(`- First seen: ${flag.firstSeen} · Last seen: ${flag.lastSeen}`)
    lines.push("")

    lines.push("### Assignments (by event count)")
    lines.push("")
    lines.push("| Assignment | Events | Subjects | Subject share |")
    lines.push("| --- | ---: | ---: | ---: |")
    for (const a of flag.assignments) {
      lines.push(`| ${a.assignment} | ${a.events} | ${a.uniqueSubjects} | ${pct(a.subjectShare)} |`)
    }
    lines.push("")

    if (flag.config) {
      lines.push("### Configured vs actual")
      lines.push("")
      if (flag.config.type === "rollout") {
        lines.push(
          `- Configured rollout: **${flag.config.configuredPercent}%** of subjects get \`${flag.config.variant}\``,
        )
        lines.push(
          `- Actual (latest assignment share): **${pct(flag.config.actualPercent / 100)}** — delta ${pts(flag.config.deltaPoints)} pts`,
        )
      } else {
        lines.push("| Variant | Configured | Actual | Delta |")
        lines.push("| --- | ---: | ---: | ---: |")
        for (const v of flag.config.variants) {
          lines.push(
            `| ${v.variant} | ${v.configuredPercent}% | ${v.actualPercent.toFixed(1)}% | ${pts(v.deltaPoints)} pts |`,
          )
        }
        if (flag.config.unexpectedVariants?.length) {
          lines.push("")
          lines.push(
            `Observed variants not present in config: ${flag.config.unexpectedVariants.map((v) => `\`${v}\``).join(", ")}`,
          )
        }
      }
      lines.push("")
    }
  }

  return lines.join("\n")
}

// --- demo -------------------------------------------------------------------

function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function subjectHashDemo(flag, userKey) {
  const scoped = `${flag}\n${userKey}`
  const hex = (seed) => (cyrb53(scoped, seed) >>> 0).toString(16).padStart(8, "0")
  return hex(0x9e3779b9) + hex(0x85ebca6b)
}

function generateDemoEvents() {
  const rand = mulberry32(20250101)
  const subjects = 4000
  const start = Date.parse("2025-01-01T00:00:00Z")
  const span = 14 * 24 * 3600 * 1000

  const flags = [
    {
      flag: "new-dashboard",
      kind: "rollout",
      rolloutPercent: 25,
      decide: (bucket) => (bucket < 25 ? "on" : "off"),
      value: (a) => a === "on",
    },
    {
      flag: "checkout-flow",
      kind: "multivariate",
      decide: (bucket) => (bucket < 60 ? "control" : "treatment"),
      value: (a) => a,
    },
    {
      flag: "beta-search",
      kind: "boolean",
      decide: (bucket) => bucket < 40,
      value: (a) => a,
    },
  ]

  const lines = []
  for (let s = 0; s < subjects; s++) {
    const userKey = `demo-user-${s}`
    // Each subject is exposed to a random subset of flags, 1–3 times.
    for (const def of flags) {
      if (rand() > 0.7) continue
      const bucket = bucketIndex(def.flag, userKey)
      const assignment = def.decide(bucket)
      const eventsForFlag = 1 + Math.floor(rand() * 2)
      for (let e = 0; e < eventsForFlag; e++) {
        const ts = new Date(start + rand() * span).toISOString()
        const variant =
          def.kind === "multivariate" ? assignment : def.kind === "rollout" ? assignment : null
        lines.push(
          JSON.stringify({
            event: "flag_exposure",
            kind: "exposure",
            flag: def.flag,
            variant,
            value: def.value(assignment),
            bucket,
            bucketCount: 100,
            subjectHash: subjectHashDemo(def.flag, userKey),
            environment: "demo",
            timestamp: ts,
          }),
        )
      }
    }
  }
  return lines.join("\n") + "\n"
}

const DEMO_CONFIG = {
  flags: {
    "new-dashboard": { type: "rollout", rolloutPercent: 25, variant: "on" },
    "checkout-flow": {
      type: "multivariate",
      variants: { control: 60, treatment: 40 },
    },
    "beta-search": { type: "rollout", rolloutPercent: 40, variant: "true" },
  },
}

// --- main -------------------------------------------------------------------

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log(
      readFileSync(new URL(import.meta.url), "utf8")
        .split("\n")
        .slice(2, 40)
        .join("\n"),
    )
    return
  }

  let inputPath = args.input
  let config = { flags: {} }

  if (args.demo) {
    const dir = mkdtempSync(join(tmpdir(), "flag-analytics-demo-"))
    inputPath = join(dir, "events.jsonl")
    writeFileSync(inputPath, generateDemoEvents(), "utf8")
    config = DEMO_CONFIG
    console.error(`Demo events written to ${inputPath}`)
  } else if (args.config) {
    config = loadConfig(args.config)
  }

  const { events, skipped } = loadEvents(inputPath)
  const report = buildReport(events, skipped, inputPath, config)

  const markdown = renderMarkdown(report)
  const json = JSON.stringify(report, null, 2)

  if (args.outMd) writeFileSync(args.outMd, markdown + "\n", "utf8")
  if (args.outJson) writeFileSync(args.outJson, json + "\n", "utf8")

  if (args.format === "md" || args.format === "both") console.log(markdown)
  if (args.format === "json" || args.format === "both") console.log(json)
}

main()
