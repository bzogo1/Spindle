#!/usr/bin/env node
// Dependency audit reporter. Parses `npm audit --json` output into a
// human-readable summary: vulnerability counts by severity and the top
// advisories. It never runs `npm audit` itself and never mutates the tree —
// feed it JSON produced by CI or a local run.
//
// Usage:
//   npm audit --json > audit.json
//   node scripts/security/deps-audit/report.mjs --file audit.json
//   node scripts/security/deps-audit/report.mjs --demo
//   cat audit.json | node scripts/security/deps-audit/report.mjs
import { readFileSync } from "node:fs"

const SEVERITY_ORDER = ["critical", "high", "moderate", "low", "info"]
const SEVERITY_EMOJI = {
  critical: "CRITICAL",
  high: "HIGH",
  moderate: "MODERATE",
  low: "LOW",
  info: "INFO",
}

const DEMO_REPORT = {
  auditReportVersion: 2,
  vulnerabilities: {
    "example-vulnerable": {
      name: "example-vulnerable",
      severity: "high",
      isDirect: true,
      via: [
        {
          source: 1234567,
          name: "example-vulnerable",
          dependency: "example-vulnerable",
          title: "Example vulnerable package allows remote code execution",
          url: "https://github.com/advisories/GHSA-xxxx-xxxx-xxxx",
          severity: "high",
          range: "<1.2.3",
        },
      ],
      effects: ["example-parent"],
      range: "<1.2.3",
      nodes: ["node_modules/example-vulnerable"],
      fixAvailable: { name: "example-vulnerable", version: "1.2.3", isSemVerMajor: false },
    },
    "example-transitive": {
      name: "example-transitive",
      severity: "moderate",
      isDirect: false,
      via: [
        {
          source: 7654321,
          name: "example-transitive",
          dependency: "example-transitive",
          title: "Example transitive package has a denial of service",
          url: "https://github.com/advisories/GHSA-yyyy-yyyy-yyyy",
          severity: "moderate",
          range: "<=2.0.0",
        },
      ],
      effects: [],
      range: "<=2.0.0",
      nodes: ["node_modules/example-parent/node_modules/example-transitive"],
      fixAvailable: true,
    },
  },
  metadata: {
    vulnerabilities: {
      info: 0,
      low: 0,
      moderate: 1,
      high: 1,
      critical: 0,
      total: 2,
    },
    dependencies: { prod: 10, dev: 5, optional: 0, peer: 0, peerOptional: 0, total: 15 },
  },
}

function parseArgs(argv) {
  const args = { file: null, demo: false, maxAdvisories: 10, json: false }
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === "--demo") args.demo = true
    else if (arg === "--json") args.json = true
    else if (arg === "--file") {
      args.file = argv[i + 1]
      i += 1
      if (!args.file) throw new Error("--file requires a path")
    } else if (arg === "--max-advisories") {
      args.maxAdvisories = Number.parseInt(argv[i + 1], 10)
      i += 1
      if (!Number.isFinite(args.maxAdvisories))
        throw new Error("--max-advisories requires a number")
    } else if (arg === "--help" || arg === "-h") {
      console.log("Usage: report.mjs [--file <audit.json>] [--demo] [--max-advisories N] [--json]")
      process.exit(0)
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }
  return args
}

function loadReport(args) {
  if (args.demo) return DEMO_REPORT
  const input = args.file ? readFileSync(args.file, "utf8") : readFileSync(0, "utf8")
  return JSON.parse(input)
}

function collectAdvisories(report) {
  const advisories = []
  const vulnerabilities = report.vulnerabilities ?? {}
  for (const [name, vuln] of Object.entries(vulnerabilities)) {
    const via = Array.isArray(vuln.via) ? vuln.via : []
    const advisoryEntries = via.filter((entry) => typeof entry === "object" && entry !== null)
    if (advisoryEntries.length === 0) {
      advisories.push({
        name,
        severity: vuln.severity ?? "unknown",
        title: `Vulnerable dependency chain via ${via.join(", ") || "unknown"}`,
        url: null,
        range: vuln.range ?? null,
        fixAvailable: vuln.fixAvailable ?? null,
        isDirect: vuln.isDirect ?? false,
      })
      continue
    }
    for (const entry of advisoryEntries) {
      advisories.push({
        name: entry.name ?? name,
        severity: entry.severity ?? vuln.severity ?? "unknown",
        title: entry.title ?? "No title provided",
        url: entry.url ?? null,
        range: entry.range ?? vuln.range ?? null,
        fixAvailable: vuln.fixAvailable ?? null,
        isDirect: vuln.isDirect ?? false,
      })
    }
  }
  const rank = { critical: 0, high: 1, moderate: 2, low: 3, info: 4, unknown: 5 }
  return advisories.sort((a, b) => (rank[a.severity] ?? 9) - (rank[b.severity] ?? 9))
}

function summarize(report) {
  const meta = report.metadata?.vulnerabilities ?? {}
  const counts = {}
  for (const sev of SEVERITY_ORDER) counts[sev] = meta[sev] ?? 0
  counts.total = meta.total ?? Object.values(counts).reduce((a, b) => a + b, 0)
  const deps = report.metadata?.dependencies ?? {}
  return { counts, dependencies: deps }
}

function renderMarkdown(report, args) {
  const { counts, dependencies } = summarize(report)
  const advisories = collectAdvisories(report).slice(0, args.maxAdvisories)
  const lines = []

  lines.push("## Dependency audit summary")
  lines.push("")
  lines.push(`| Severity | Count |`)
  lines.push(`| --- | ---: |`)
  for (const sev of SEVERITY_ORDER) {
    if (counts[sev] > 0 || sev === "critical" || sev === "high") {
      lines.push(`| ${SEVERITY_EMOJI[sev]} | ${counts[sev]} |`)
    }
  }
  lines.push(`| **Total** | **${counts.total}** |`)
  lines.push("")
  if (dependencies.total) {
    lines.push(
      `Dependencies scanned: ${dependencies.total} ` +
        `(${dependencies.prod ?? 0} prod, ${dependencies.dev ?? 0} dev).`,
    )
    lines.push("")
  }

  if (advisories.length === 0) {
    lines.push("No advisories found.")
    return lines.join("\n")
  }

  lines.push(`### Top advisories (showing ${advisories.length})`)
  lines.push("")
  for (const adv of advisories) {
    const label = adv.url ? `[${adv.title}](${adv.url})` : adv.title
    const extras = [
      adv.range ? `range \`${adv.range}\`` : null,
      adv.isDirect ? "direct" : "transitive",
    ]
      .filter(Boolean)
      .join(", ")
    lines.push(
      `- **${SEVERITY_EMOJI[adv.severity] ?? adv.severity.toUpperCase()}** ${label} — ${adv.name} (${extras})`,
    )
  }
  return lines.join("\n")
}

function main() {
  const args = parseArgs(process.argv)
  const report = loadReport(args)
  if (!report || typeof report !== "object" || !report.metadata) {
    throw new Error("Input is not a valid `npm audit --json` report (missing metadata)")
  }
  if (args.json) {
    console.log(JSON.stringify(report, null, 2))
    return
  }
  console.log(renderMarkdown(report, args))
}

try {
  main()
} catch (error) {
  console.error(`deps-audit report: ${error.message}`)
  process.exit(1)
}
