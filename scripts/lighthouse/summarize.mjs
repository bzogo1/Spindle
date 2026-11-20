#!/usr/bin/env node
// Summarize Lighthouse CI results and optionally re-check the budgets in
// lighthouserc.json — without needing Chrome or a running server.
//
//   node scripts/lighthouse/summarize.mjs                 # markdown table
//   node scripts/lighthouse/summarize.mjs --json          # machine-readable
//   node scripts/lighthouse/summarize.mjs --check         # exit 1 on budget breach
//   node scripts/lighthouse/summarize.mjs --dir <path>    # other .lighthouseci dir
//   node scripts/lighthouse/summarize.mjs --demo          # synthetic data, offline
//
// Input is the raw LHCI output directory (default .lighthouseci/), which
// contains one lhr-*.json per audited page per run. Runs are aggregated with
// the median, matching how `lhci assert` evaluates them.
//
// --check applies the assertions from lighthouserc.json (default: repo root)
// to the per-URL medians. Exit codes: 0 pass, 1 budget breach, 2 usage/IO.

import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const USAGE = `Usage: node scripts/lighthouse/summarize.mjs [options]

Options:
  --dir <path>          Directory with lhr-*.json files (default: .lighthouseci)
  --lighthouserc <file> Assertion config to check against (default: lighthouserc.json)
  --check               Evaluate lighthouserc assertions; exit 1 on 'error' breach
  --json                Emit JSON instead of a markdown table
  --demo                Generate synthetic LHRs in a temp dir and summarize them
  --help                Show this help
`

const METRICS = [
  ["largest-contentful-paint", "LCP", "ms"],
  ["first-contentful-paint", "FCP", "ms"],
  ["total-blocking-time", "TBT", "ms"],
  ["cumulative-layout-shift", "CLS", ""],
  ["speed-index", "SI", "ms"],
  ["interactive", "TTI", "ms"],
  ["server-response-time", "TTFB", "ms"],
]

const CATEGORIES = ["performance", "accessibility", "best-practices", "seo"]

function parseArgs(argv) {
  const opts = {
    dir: ".lighthouseci",
    lighthouserc: "lighthouserc.json",
    check: false,
    json: false,
    demo: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--help" || arg === "-h") {
      console.log(USAGE)
      process.exit(0)
    } else if (arg === "--check") opts.check = true
    else if (arg === "--json") opts.json = true
    else if (arg === "--demo") opts.demo = true
    else if (arg === "--dir") opts.dir = argv[++i]
    else if (arg === "--lighthouserc") opts.lighthouserc = argv[++i]
    else {
      console.error(`Unknown argument: ${arg}\n`)
      console.error(USAGE)
      process.exit(2)
    }
  }
  if (opts.dir === undefined || opts.lighthouserc === undefined) {
    console.error(USAGE)
    process.exit(2)
  }
  return opts
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

function loadLhrs(dir) {
  if (!existsSync(dir)) {
    console.error(`No Lighthouse output directory at ${dir}. Run 'npx lhci collect' first.`)
    process.exit(2)
  }
  const files = readdirSync(dir).filter((f) => /^lhr-.*\.json$/.test(f))
  if (files.length === 0) {
    console.error(`No lhr-*.json files found in ${dir}.`)
    process.exit(2)
  }
  return files.map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")))
}

function demoDir() {
  const dir = mkdtempSync(join(tmpdir(), "lighthouse-demo-"))
  const pages = [
    ["http://localhost:3000/", 1900, 0.02, 90, 0.99],
    ["http://localhost:3000/pricing", 2050, 0.03, 110, 0.97],
    ["http://localhost:3000/referral", 1750, 0.01, 80, 0.99],
    ["http://localhost:3000/contact", 2200, 0.04, 95, 0.96],
  ]
  let n = 0
  for (const [url, lcp, cls, tbt, perf] of pages) {
    for (let run = 0; run < 3; run++) {
      const lhr = {
        finalDisplayedUrl: url,
        audits: {
          "largest-contentful-paint": { numericValue: lcp + run * 25 },
          "first-contentful-paint": { numericValue: lcp * 0.6 },
          "total-blocking-time": { numericValue: tbt + run * 5 },
          "cumulative-layout-shift": { numericValue: cls },
          "speed-index": { numericValue: lcp * 1.4 },
          interactive: { numericValue: lcp * 1.8 },
          "server-response-time": { numericValue: 120 },
        },
        categories: {
          performance: { score: perf },
          accessibility: { score: 0.98 },
          "best-practices": { score: 1 },
          seo: { score: 1 },
        },
      }
      writeFileSync(join(dir, `lhr-demo-${n++}.json`), JSON.stringify(lhr))
    }
  }
  return dir
}

function summarize(lhrs) {
  const byUrl = new Map()
  for (const lhr of lhrs) {
    const url = lhr.finalDisplayedUrl || lhr.requestedUrl || "(unknown)"
    if (!byUrl.has(url)) byUrl.set(url, [])
    byUrl.get(url).push(lhr)
  }

  const report = {}
  for (const [url, runs] of byUrl) {
    const entry = { runs: runs.length, metrics: {}, categories: {} }
    for (const [auditId, label, unit] of METRICS) {
      const values = runs
        .map((r) => r.audits?.[auditId]?.numericValue)
        .filter((v) => typeof v === "number")
      if (values.length > 0) {
        const med = median(values)
        entry.metrics[label] = {
          auditId,
          unit,
          median: med,
          min: Math.min(...values),
          max: Math.max(...values),
        }
      }
    }
    for (const cat of CATEGORIES) {
      const values = runs
        .map((r) => r.categories?.[cat]?.score)
        .filter((v) => typeof v === "number")
      if (values.length > 0) entry.categories[cat] = median(values)
    }
    report[url] = entry
  }
  return report
}

// Minimal evaluator for the lhci assertion syntax used in lighthouserc.json:
//   "audit-id": ["error"|"warn"|"off", { minScore | maxNumericValue | ... }]
// Returns [{ url, assertion, level, expected, actual, passed }]. Category
// scores are stored under their short name; numeric audits are matched by
// auditId against the metric entries.
function evaluateAssertions(report, config) {
  const assertions = config?.ci?.assert?.assertions
  if (!assertions) return []
  const results = []
  for (const [key, spec] of Object.entries(assertions)) {
    const [level, opts = {}] = Array.isArray(spec) ? spec : ["error", spec]
    if (level === "off") continue
    for (const [url, entry] of Object.entries(report)) {
      let actual
      let expected
      let ok
      if (key.startsWith("categories:")) {
        actual = entry.categories[key.slice("categories:".length)]
        expected = opts.minScore
        ok = actual !== undefined && expected !== undefined && actual >= expected
      } else {
        const metric = Object.values(entry.metrics).find((m) => m.auditId === key)
        actual = metric?.median
        if (opts.maxNumericValue !== undefined) {
          expected = opts.maxNumericValue
          ok = actual !== undefined && actual <= expected
        } else if (opts.minNumericValue !== undefined) {
          expected = opts.minNumericValue
          ok = actual !== undefined && actual >= expected
        } else {
          expected = undefined
          ok = actual !== undefined
        }
      }
      results.push({ url, assertion: key, level, expected, actual, passed: ok })
    }
  }
  return results
}

function fmt(value, unit) {
  if (value === undefined) return "—"
  if (unit === "") return value.toFixed(3)
  return `${Math.round(value)} ${unit}`
}

function main() {
  const opts = parseArgs(process.argv.slice(2))
  const dir = opts.demo ? demoDir() : opts.dir
  const lhrs = loadLhrs(dir)
  const report = summarize(lhrs)

  if (opts.json) {
    console.log(JSON.stringify(report, null, 2))
  } else {
    const urls = Object.keys(report).sort()
    const metricKeys = [...new Set(urls.flatMap((u) => Object.keys(report[u].metrics)))]
    const header = ["URL", "runs", ...metricKeys, ...CATEGORIES.map((c) => c.slice(0, 4))]
    const rows = urls.map((url) => {
      const e = report[url]
      return [
        url,
        String(e.runs),
        ...metricKeys.map((k) =>
          e.metrics[k] ? fmt(e.metrics[k].median, e.metrics[k].unit) : "—",
        ),
        ...CATEGORIES.map((c) =>
          e.categories[c] !== undefined ? e.categories[c].toFixed(2) : "—",
        ),
      ]
    })
    const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)))
    const line = (cells) => cells.map((c, i) => c.padEnd(widths[i])).join("  ")
    console.log(line(header))
    console.log(widths.map((w) => "-".repeat(w)).join("  "))
    for (const row of rows) console.log(line(row))
    if (opts.demo) console.log(`\n(demo data in ${dir})`)
  }

  if (opts.check) {
    if (!existsSync(opts.lighthouserc)) {
      console.error(`Assertion config not found: ${opts.lighthouserc}`)
      process.exit(2)
    }
    const config = JSON.parse(readFileSync(opts.lighthouserc, "utf8"))
    const results = evaluateAssertions(report, config)
    let failed = false
    for (const r of results) {
      const mark = r.passed
        ? r.level === "warn"
          ? "warn-pass"
          : "pass"
        : r.level === "warn"
          ? "WARN "
          : "FAIL "
      if (!r.passed && r.level === "error") failed = true
      console.error(`${mark} ${r.url} :: ${r.assertion} expected ${r.expected}, got ${r.actual}`)
    }
    process.exit(failed ? 1 : 0)
  }
}

main()
