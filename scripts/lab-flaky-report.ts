/**
 * Flaky-test report for lab snapshot runs.
 *
 * Reads `<root>/history.jsonl` (appended by `scripts/lab-snapshot-diff.ts` on
 * every case), runs `analyzeFlakiness`, prints a per-case table, and writes:
 *   <root>/flaky-report.json   machine-readable report
 *   <root>/quarantine.md       markdown quarantine list (paste into docs or
 *                              a tracking issue)
 *
 * Usage:
 *   tsx scripts/lab-flaky-report.ts [--dir <path>] [--min-runs <n>]
 *     [--quarantine <name1,name2>] [--json]
 *
 * Options:
 *   --dir <path>          Snapshot root (default .lab-snapshots / LAB_SNAPSHOT_DIR)
 *   --min-runs <n>        Minimum runs before a verdict (default 3)
 *   --quarantine <list>   Comma-separated case names already quarantined
 *   --json                Print the full report JSON to stdout instead of table
 */

import { readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"

import {
  analyzeFlakiness,
  parseHistoryJsonl,
  snapshotRoot,
  type FlakinessReport,
} from "../src/lib/lab-snapshots/index"

interface CliOptions {
  dir?: string
  minRuns?: number
  quarantine?: string[]
  json: boolean
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = { json: false }
  for (let i = 0; i < argv.length; i++) {
    const next = () => argv[++i]
    switch (argv[i]) {
      case "--dir":
        opts.dir = next()
        break
      case "--min-runs":
        opts.minRuns = Number(next())
        break
      case "--quarantine":
        opts.quarantine = next()
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
        break
      case "--json":
        opts.json = true
        break
      default:
        if (argv[i].startsWith("--")) throw new Error(`Unknown option: ${argv[i]}`)
    }
  }
  return opts
}

function quarantineMarkdown(report: FlakinessReport): string {
  const lines = [
    "# Lab snapshot quarantine list",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    "Cases flagged flaky by `scripts/lab-flaky-report.ts`. Quarantined cases",
    "should be excluded from gating (see docs/lab-snapshots.md) until the",
    "underlying nondeterminism is fixed.",
    "",
  ]
  if (
    report.cases.filter((c) => c.verdict === "flaky" || c.verdict === "quarantined").length === 0
  ) {
    lines.push("_No quarantined cases._")
  } else {
    lines.push("| Case | Verdict | Runs | Pass rate | Flaky score | Reasons |")
    lines.push("| --- | --- | --- | --- | --- | --- |")
    for (const c of report.cases.filter((x) => x.verdict !== "stable")) {
      lines.push(
        `| \`${c.caseName}\` | ${c.verdict} | ${c.runs} | ${(c.passRate * 100).toFixed(0)}% | ${c.flakyScore} | ${c.reasons.join("; ") || "—"} |`,
      )
    }
  }
  lines.push("")
  return lines.join("\n")
}

async function main(): Promise<number> {
  const cli = parseArgs(process.argv.slice(2))
  cli.dir ??= process.env.LAB_SNAPSHOT_DIR
  const root = snapshotRoot(cli.dir)
  const historyPath = join(root, "history.jsonl")

  let content
  try {
    content = await readFile(historyPath, "utf8")
  } catch {
    console.log(`No history file at ${historyPath} — run lab:snapshots:diff first.`)
    return 0
  }

  const records = parseHistoryJsonl(content)
  if (records.length === 0) {
    console.log("history.jsonl contains no parseable records.")
    return 0
  }

  const report = analyzeFlakiness(records, {
    minRuns: cli.minRuns,
    alreadyQuarantined: cli.quarantine,
  })

  if (cli.json) {
    console.log(JSON.stringify(report, null, 2))
    return 0
  }

  console.log(`Flaky-test report — ${records.length} record(s) from ${historyPath}\n`)
  for (const line of report.summary) console.log(line)
  console.log("")
  console.log(
    "case".padEnd(32) +
      "verdict".padEnd(12) +
      "runs".padEnd(6) +
      "pass%".padEnd(7) +
      "cv".padEnd(8) +
      "score",
  )
  for (const c of report.cases) {
    console.log(
      c.caseName.padEnd(32) +
        c.verdict.padEnd(12) +
        String(c.runs).padEnd(6) +
        `${(c.passRate * 100).toFixed(0)}%`.padEnd(7) +
        (Number.isFinite(c.diffRatioCv) ? c.diffRatioCv.toFixed(2) : "∞").padEnd(8) +
        String(c.flakyScore),
    )
    for (const reason of c.reasons) console.log(`    ↳ ${reason}`)
  }

  const reportPath = join(root, "flaky-report.json")
  const quarantinePath = join(root, "quarantine.md")
  await writeFile(reportPath, JSON.stringify(report, null, 2))
  await writeFile(quarantinePath, quarantineMarkdown(report))
  console.log(`\nWrote ${reportPath} and ${quarantinePath}`)
  return 0
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(2)
  })
