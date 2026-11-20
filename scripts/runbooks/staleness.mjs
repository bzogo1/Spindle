#!/usr/bin/env node
// Runbook staleness checker.
//
//   node scripts/runbooks/staleness.mjs [options]
//
// For every runbook (docs/runbooks/*.md + docs/resilience/*.md) finds the last
// commit that touched it (`git log -1`) and flags runbooks whose review age
// exceeds --days (default 90). Files with no git history (untracked or
// freshly added) fall back to their filesystem mtime and are reported with
// source "mtime" — they are never silently treated as fresh.
//
// Options:
//   --days <n>   staleness threshold in days (default 90)
//   --json       emit the report as JSON
//   --ci         exit 1 when any runbook is stale (for CI gates)
//   --demo       offline demo: fixed "now" and no git lookups; always exits 0
//   -h, --help   show this help
//
// Exit codes: 0 all fresh (or --demo), 1 stale runbooks with --ci, 2 usage
// error. Without --ci the report always exits 0 — staleness is advisory.

import {
  ROOT,
  ageInDays,
  lastReviewed,
  listRunbooks,
  loadRegistry,
  readRunbook,
  runbookTitle,
} from "./lib.mjs"

const USAGE = `Usage: node scripts/runbooks/staleness.mjs [options]

Options:
  --days <n>   staleness threshold in days (default 90)
  --json       emit the report as JSON
  --ci         exit 1 when any runbook is stale
  --demo       offline mode: file mtimes only, fixed timestamp; exits 0
  -h, --help   show this help

Exit codes: 0 fresh/demo, 1 stale (--ci), 2 usage error.`

function parseArgs(argv) {
  const options = { days: 90, json: false, ci: false, demo: false, help: false }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const next = () => argv[++i]
    switch (arg) {
      case "--days": {
        const value = Number(next())
        if (!Number.isInteger(value) || value < 1) usageError("--days requires a positive integer")
        options.days = value
        break
      }
      case "--json":
        options.json = true
        break
      case "--ci":
        options.ci = true
        break
      case "--demo":
        options.demo = true
        break
      case "--help":
      case "-h":
        options.help = true
        break
      default:
        usageError(`Unknown argument: ${arg}`)
    }
  }
  return options
}

function usageError(message) {
  console.error(`error: ${message}`)
  console.error(USAGE)
  process.exit(2)
}

const options = parseArgs(process.argv.slice(2))
if (options.help) {
  console.log(USAGE)
  process.exit(0)
}

// Demo uses a fixed "now" so output is deterministic; real runs use the clock.
const now = options.demo ? new Date("2026-11-21T00:00:00Z") : new Date()
const registry = loadRegistry(ROOT)
const entries = []

for (const relPath of listRunbooks(ROOT)) {
  const reviewed = lastReviewed(ROOT, relPath, { useGit: !options.demo, now })
  const meta = registry[relPath] ?? {}
  // A registry lastReviewed date is the authoritative human review marker;
  // git/mtime tells us when the file last changed.
  const reviewDate = meta.lastReviewed ? new Date(`${meta.lastReviewed}T00:00:00Z`) : null
  const reviewAge = reviewDate ? ageInDays(reviewDate, now) : reviewed.ageDays
  const stale = reviewAge === null || reviewAge > options.days
  entries.push({
    path: relPath,
    title: runbookTitle(readRunbook(ROOT, relPath)),
    owner: meta.owner ?? null,
    severity: meta.severity ?? null,
    lastChanged: reviewed.date,
    lastChangedSource: options.demo ? "demo" : reviewed.source,
    lastReviewed: meta.lastReviewed ?? reviewed.date?.slice(0, 10) ?? null,
    reviewAgeDays: reviewAge,
    stale,
  })
}

const staleEntries = entries.filter((e) => e.stale)
const report = {
  generatedAt: now.toISOString(),
  thresholdDays: options.days,
  demo: options.demo,
  runbookCount: entries.length,
  staleCount: staleEntries.length,
  runbooks: entries,
}

if (options.json) {
  console.log(JSON.stringify(report, null, 2))
} else {
  console.log(
    `Runbook staleness — threshold ${options.days} days` +
      (options.demo ? " (demo: mtimes only, fixed clock)" : ""),
  )
  console.log("")
  for (const e of entries) {
    const flag = e.stale ? "STALE" : "ok   "
    console.log(
      `${flag}  ${e.path.padEnd(42)} reviewed=${e.lastReviewed ?? "?"} ` +
        `age=${e.reviewAgeDays ?? "?"}d  src=${e.lastChangedSource}`,
    )
  }
  console.log("")
  console.log(
    `${entries.length} runbooks, ${staleEntries.length} stale` +
      (options.ci && staleEntries.length ? " — failing (--ci)" : ""),
  )
}

if (options.demo) process.exit(0)
process.exit(options.ci && staleEntries.length > 0 ? 1 : 0)
