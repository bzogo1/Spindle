#!/usr/bin/env node
// Runbook linter / validator.
//
//   node scripts/runbooks/lint.mjs [options]
//
// For every runbook (docs/runbooks/*.md + docs/resilience/*.md) checks that:
//   - the document has an H1 title;
//   - every repo-path reference (markdown links and backtick-quoted paths such
//     as scripts/db/migrate.mjs) resolves to a file that exists;
//   - every script invoked from a command block exists on disk, and every
//     `npm run <name>` refers to a script defined in package.json — the same
//     "verify the referenced script exists" pattern the DR drill runner uses
//     for its scenario commands;
//   - each runbook has a registry.json entry with a known severity, and every
//     `relatedScripts` path in the registry resolves to a file that exists.
//
// Options:
//   --json     emit findings as JSON
//   --demo     offline demo: lint a built-in fixture runbook (one good, one
//              bad) instead of the repository; always exits 0
//   --strict   promote registry-coverage warnings to errors
//   -h, --help show this help
//
// Exit codes: 0 clean (or --demo), 1 findings, 2 usage error.

import { existsSync } from "node:fs"
import { dirname, join } from "node:path"
import {
  ROOT,
  SEVERITIES,
  extractCommands,
  extractPathReferences,
  listRunbooks,
  loadRegistry,
  packageJsonScripts,
  readRunbook,
  runbookTitle,
  scriptTargetsInCommand,
} from "./lib.mjs"

const USAGE = `Usage: node scripts/runbooks/lint.mjs [options]

Options:
  --json     emit findings as JSON
  --demo     lint built-in fixtures instead of the repo; always exits 0
  --strict   registry-coverage warnings become errors
  -h, --help show this help

Exit codes: 0 clean/demo, 1 findings, 2 usage error.`

function parseArgs(argv) {
  const options = { json: false, demo: false, strict: false, help: false }
  for (const arg of argv) {
    switch (arg) {
      case "--json":
        options.json = true
        break
      case "--demo":
        options.demo = true
        break
      case "--strict":
        options.strict = true
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

// ---------------------------------------------------------------------------
// Lint core
// ---------------------------------------------------------------------------

function lintDocument(root, relPath, markdown, { registry, npmScripts, strict }) {
  const findings = []
  const push = (severity, rule, message) => findings.push({ rule, severity, message })

  if (!runbookTitle(markdown)) {
    push("error", "missing-title", "runbook has no H1 (# ...) title")
  }

  // 1. Referenced paths must exist. Glob references (docs/runbooks/*.md)
  //    are checked by verifying their static prefix directory exists.
  const GLOB_CHARS = /[*?[\]{}]/
  for (const ref of extractPathReferences(root, relPath, markdown)) {
    let exists = existsSync(ref.abs)
    if (!exists && GLOB_CHARS.test(ref.rel)) {
      const prefix = ref.rel.split(GLOB_CHARS)[0].replace(/\/+$/, "")
      const checkPath = prefix.includes(".") ? dirname(join(root, prefix)) : join(root, prefix)
      exists = existsSync(checkPath)
    }
    if (!exists) {
      push("error", "missing-path", `references \`${ref.rel}\` (${ref.via}) but it does not exist`)
    }
  }

  // 2. Command script targets must exist.
  const commands = extractCommands(markdown)
  for (const command of commands) {
    for (const target of scriptTargetsInCommand(command)) {
      if (target.startsWith("npm:")) {
        const name = target.slice(4)
        if (!(name in npmScripts)) {
          push(
            "error",
            "missing-npm-script",
            `command \`${command.text}\` runs \`npm run ${name}\` which is not in package.json`,
          )
        }
        continue
      }
      const abs = join(root, target)
      if (!existsSync(abs)) {
        push(
          "error",
          "missing-script",
          `command \`${command.text}\` invokes \`${target}\` which does not exist`,
        )
      }
    }
  }
  if (commands.length === 0) {
    push("warn", "no-commands", "no executable commands found in the runbook")
  }

  // 3. Registry coverage.
  const meta = registry[relPath]
  if (!meta) {
    push(strict ? "error" : "warn", "unregistered", "no entry in scripts/runbooks/registry.json")
  } else if (meta.severity && !SEVERITIES.includes(meta.severity)) {
    push(
      "warn",
      "bad-severity",
      `registry severity "${meta.severity}" is not one of ${SEVERITIES.join("/")}`,
    )
  }

  return { path: relPath, commandCount: commands.length, findings }
}

// ---------------------------------------------------------------------------
// Registry cross-check — every relatedScripts path must exist, even for
// registry entries whose document is not (or no longer) a linted runbook.
// ---------------------------------------------------------------------------

function lintRegistry(root, registry) {
  const findingsByPath = new Map()
  for (const [relPath, meta] of Object.entries(registry)) {
    for (const script of meta.relatedScripts ?? []) {
      if (!existsSync(join(root, script))) {
        const findings = findingsByPath.get(relPath) ?? []
        findings.push({
          rule: "missing-related-script",
          severity: "error",
          message: `registry relatedScripts entry \`${script}\` does not exist`,
        })
        findingsByPath.set(relPath, findings)
      }
    }
  }
  return findingsByPath
}

// ---------------------------------------------------------------------------
// Demo fixtures — exercised with --demo, never touch the repository.
// ---------------------------------------------------------------------------

const DEMO_DOCS = [
  {
    path: "docs/runbooks/_demo-good.md",
    markdown: `# Demo — good runbook

Restart the worker with a dry run first:

\`\`\`bash
node scripts/db/migrate.mjs --dry-run
npm run secrets:check
\`\`\`
`,
  },
  {
    path: "docs/runbooks/_demo-bad.md",
    markdown: `No title here.

Run \`node scripts/does/not/exist.mjs --dry-run\` and
\`npm run not-a-real-script\` after reading \`scripts/missing.ts\`.
`,
  },
]

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

let results
if (options.demo) {
  // Demo lints fixtures against the REAL repo root so the good fixture passes
  // path checks and the bad fixture produces every rule.
  results = DEMO_DOCS.map((doc) =>
    lintDocument(ROOT, doc.path, doc.markdown, {
      registry: {},
      npmScripts: packageJsonScripts(ROOT),
      strict: false,
    }),
  )
} else {
  const registry = loadRegistry(ROOT)
  const npmScripts = packageJsonScripts(ROOT)
  results = listRunbooks(ROOT).map((relPath) =>
    lintDocument(ROOT, relPath, readRunbook(ROOT, relPath), {
      registry,
      npmScripts,
      strict: options.strict,
    }),
  )
  // Merge registry relatedScripts findings into the matching document result,
  // or surface them as their own result for registry-only paths.
  const byPath = new Map(results.map((r) => [r.path, r]))
  for (const [relPath, findings] of lintRegistry(ROOT, registry)) {
    const existing = byPath.get(relPath)
    if (existing) {
      existing.findings.push(...findings)
    } else {
      results.push({ path: relPath, commandCount: 0, findings })
    }
  }
}

const errors = results.flatMap((r) => r.findings.filter((f) => f.severity === "error"))
const warns = results.flatMap((r) => r.findings.filter((f) => f.severity === "warn"))

if (options.json) {
  console.log(
    JSON.stringify(
      {
        demo: options.demo,
        runbooks: results,
        summary: {
          runbooks: results.length,
          errors: errors.length,
          warnings: warns.length,
        },
      },
      null,
      2,
    ),
  )
} else {
  for (const result of results) {
    const marks = result.findings.map((f) => `${f.severity === "error" ? "✗" : "!"} ${f.rule}`)
    console.log(
      `${result.path}  (${result.commandCount} commands)` +
        (marks.length ? `\n    ${marks.join("\n    ")}` : "  clean"),
    )
    for (const f of result.findings) {
      console.log(`    ${f.severity === "error" ? "ERROR" : "warn "} [${f.rule}] ${f.message}`)
    }
  }
  console.log(
    `\n${results.length} runbooks checked: ${errors.length} errors, ${warns.length} warnings` +
      (options.demo ? " (demo fixtures)" : ""),
  )
}

process.exit(options.demo ? 0 : errors.length > 0 ? 1 : 0)
