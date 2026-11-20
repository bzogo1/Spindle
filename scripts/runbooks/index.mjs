#!/usr/bin/env node
// Runbook index generator.
//
//   node scripts/runbooks/index.mjs [options]
//
// Scans docs/runbooks/*.md and docs/resilience/*.md, merges in the metadata
// from scripts/runbooks/registry.json, resolves each runbook's last-reviewed
// date (git log, falling back to file mtime for untracked files), and prints a
// registry — markdown table by default, JSON with --json.
//
// Options:
//   --json          emit the raw index as JSON instead of markdown
//   --out <file>    write the markdown index to <file> instead of stdout
//                   (use "-" for stdout, the default)
//   --demo          offline demo: skip git entirely, use file mtimes, and
//                   mark sources as "demo"; no repository state is consulted
//   -h, --help      show this help
//
// Exit codes: 0 success, 2 usage error.

import { writeFileSync } from "node:fs"
import { resolve } from "node:path"
import {
  ROOT,
  SEVERITIES,
  lastReviewed,
  listRunbooks,
  loadRegistry,
  readRunbook,
  runbookTitle,
} from "./lib.mjs"

const USAGE = `Usage: node scripts/runbooks/index.mjs [options]

Options:
  --json          emit the raw index as JSON instead of markdown
  --out <file>    write markdown to <file> ("-" = stdout, the default)
  --demo          offline mode: no git lookups, mtimes only
  -h, --help      show this help

Exit codes: 0 success, 2 usage error.`

function parseArgs(argv) {
  const options = { json: false, demo: false, help: false, out: "-" }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const next = () => argv[++i]
    switch (arg) {
      case "--json":
        options.json = true
        break
      case "--demo":
        options.demo = true
        break
      case "--help":
      case "-h":
        options.help = true
        break
      case "--out": {
        const value = next()
        if (!value) usageError("--out requires a file path")
        options.out = value
        break
      }
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

// ---------------------------------------------------------------------------
// Build the index
// ---------------------------------------------------------------------------

const registry = loadRegistry(ROOT)
const now = new Date()
const entries = []
const warnings = []

for (const relPath of listRunbooks(ROOT)) {
  const markdown = readRunbook(ROOT, relPath)
  const meta = registry[relPath] ?? {}
  const reviewed = lastReviewed(ROOT, relPath, { useGit: !options.demo, now })

  if (meta.severity && !SEVERITIES.includes(meta.severity)) {
    warnings.push(`${relPath}: unknown severity "${meta.severity}" in registry.json`)
  }
  if (!meta.owner) {
    warnings.push(`${relPath}: no owner in registry.json`)
  }

  entries.push({
    path: relPath,
    title: runbookTitle(markdown),
    owner: meta.owner ?? null,
    severity: meta.severity ?? null,
    lastReviewed: meta.lastReviewed ?? reviewed.date,
    lastReviewedSource: meta.lastReviewed ? "registry" : options.demo ? "demo" : reviewed.source,
    ageDays: reviewed.ageDays,
    relatedAlerts: meta.relatedAlerts ?? [],
    relatedScripts: meta.relatedScripts ?? [],
    tags: meta.tags ?? [],
  })
}

const index = {
  generatedAt: now.toISOString(),
  demo: options.demo,
  runbookCount: entries.length,
  registryEntries: Object.keys(registry).length,
  unregistered: entries.filter((e) => !registry[e.path]).map((e) => e.path),
  warnings,
  runbooks: entries,
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

if (options.json) {
  console.log(JSON.stringify(index, null, 2))
  process.exit(0)
}

const lines = []
lines.push("# Runbook index")
lines.push("")
lines.push(
  `Generated ${index.generatedAt} — ${index.runbookCount} runbooks ` +
    `(${index.registryEntries} registry entries). ` +
    (options.demo ? "_demo mode: dates from file mtimes only._" : "_dates from git log._"),
)
lines.push("")
lines.push("| Runbook | Title | Owner | Severity | Last reviewed | Age (days) | Alerts |")
lines.push("| ------- | ----- | ----- | -------- | ------------- | ---------- | ------ |")
for (const e of entries) {
  const alerts = e.relatedAlerts.length ? e.relatedAlerts.join(", ") : "—"
  lines.push(
    `| \`${e.path}\` | ${e.title ?? "—"} | ${e.owner ?? "—"} | ${e.severity ?? "—"} ` +
      `| ${e.lastReviewed ? e.lastReviewed.slice(0, 10) : "—"} (${e.lastReviewedSource}) ` +
      `| ${e.ageDays ?? "—"} | ${alerts} |`,
  )
}
lines.push("")
for (const e of entries) {
  const scripts = e.relatedScripts.length ? e.relatedScripts.map((s) => `\`${s}\``).join(", ") : "—"
  lines.push(`## \`${e.path}\``)
  lines.push("")
  lines.push(`- **Title:** ${e.title ?? "—"}`)
  lines.push(`- **Owner:** ${e.owner ?? "—"}  **Severity:** ${e.severity ?? "—"}`)
  lines.push(
    `- **Last reviewed:** ${e.lastReviewed ?? "unknown"} (${e.lastReviewedSource})` +
      (e.ageDays !== null ? ` — ${e.ageDays} days ago` : ""),
  )
  lines.push(`- **Tags:** ${e.tags.length ? e.tags.join(", ") : "—"}`)
  lines.push(`- **Related alerts:** ${e.relatedAlerts.length ? e.relatedAlerts.join(", ") : "—"}`)
  lines.push(`- **Related scripts:** ${scripts}`)
  lines.push("")
}
if (index.unregistered.length) {
  lines.push("## Unregistered runbooks")
  lines.push("")
  lines.push("These files exist but have no entry in `scripts/runbooks/registry.json`:")
  lines.push("")
  for (const p of index.unregistered) lines.push(`- \`${p}\``)
  lines.push("")
}
if (warnings.length) {
  lines.push("## Registry warnings")
  lines.push("")
  for (const w of warnings) lines.push(`- ${w}`)
  lines.push("")
}

const output = `${lines.join("\n")}\n`
if (options.out === "-") {
  process.stdout.write(output)
} else {
  const target = resolve(ROOT, options.out)
  writeFileSync(target, output)
  console.log(`wrote ${target}`)
}
