#!/usr/bin/env node
// Runbook command executor (dry-run by default).
//
//   node scripts/runbooks/execute.mjs <runbook> [options]
//
// Extracts the verifiable commands from a runbook — fenced bash/sh/console
// blocks plus inline `code` spans that start with a known command — and either
// prints the execution plan (default), simulates it (--demo), or runs ONLY the
// commands that carry an explicit no-side-effect flag (--execute).
//
// A command is "dry-run safe" when it invokes a repo script through
// node/npx/tsx/npm and includes --dry-run, --demo, --help, --list, or --plan.
// Everything else is reported as plan-only and is never executed, even with
// --execute. This mirrors the drill runner's rule that automation only ever
// invokes scripts in their dry-run/plan modes.
//
// Options:
//   <runbook>        path to a runbook, e.g. docs/runbooks/database-backup.md
//                    (basename also works: database-backup)
//   --demo           offline demo: print simulated results, run nothing
//   --execute        actually run dry-run-safe commands (others are skipped)
//   --only <substr>  only include commands containing <substr>
//   --timeout <ms>   per-command timeout for --execute (default 120000)
//   --json           emit the plan/results as JSON
//   -h, --help       show this help
//
// Exit codes: 0 plan clean / all executed ok / demo, 1 a command failed,
// 2 usage error.

import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { join } from "node:path"
import {
  ROOT,
  classifyCommand,
  extractCommands,
  listRunbooks,
  readRunbook,
  runbookTitle,
} from "./lib.mjs"

const USAGE = `Usage: node scripts/runbooks/execute.mjs <runbook> [options]

Options:
  <runbook>        runbook path or basename (docs/runbooks|docs/resilience)
  --demo           simulate results offline; nothing executes
  --execute        run only dry-run-safe commands; plan-only otherwise
  --only <substr>  filter commands by substring
  --timeout <ms>   per-command timeout for --execute (default 120000)
  --json           emit JSON
  -h, --help       show this help

Exit codes: 0 ok/demo, 1 command failure, 2 usage error.`

function parseArgs(argv) {
  const options = {
    demo: false,
    execute: false,
    json: false,
    help: false,
    timeout: 120000,
    only: null,
    target: null,
  }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const next = () => argv[++i]
    switch (arg) {
      case "--demo":
        options.demo = true
        break
      case "--execute":
        options.execute = true
        break
      case "--json":
        options.json = true
        break
      case "--help":
      case "-h":
        options.help = true
        break
      case "--only": {
        const value = next()
        if (!value) usageError("--only requires a substring")
        options.only = value
        break
      }
      case "--timeout": {
        const value = Number(next())
        if (!Number.isInteger(value) || value < 1)
          usageError("--timeout requires a positive integer")
        options.timeout = value
        break
      }
      default:
        if (arg.startsWith("--")) usageError(`Unknown argument: ${arg}`)
        if (options.target) usageError(`Unexpected extra argument: ${arg}`)
        options.target = arg
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
if (!options.target) usageError("a runbook path or basename is required")
if (options.demo && options.execute) usageError("--demo and --execute are mutually exclusive")

// Resolve the runbook argument: exact repo-relative path, or unique basename.
function resolveRunbook(target) {
  const candidates = [
    target,
    target.endsWith(".md") ? target : `${target}.md`,
    ...listRunbooks(ROOT).filter((p) => p.endsWith(`/${target}`) || p.endsWith(`/${target}.md`)),
  ]
  const unique = [...new Set(candidates)]
  const existing = unique.filter((p) => existsSync(join(ROOT, p)))
  if (existing.length === 1) return existing[0]
  if (existing.length > 1) usageError(`ambiguous runbook "${target}": ${existing.join(", ")}`)
  usageError(`runbook not found: ${target} (tried ${unique.join(", ")})`)
}

const relPath = resolveRunbook(options.target)
const markdown = readRunbook(ROOT, relPath)

let commands = extractCommands(markdown).map((c, i) => ({
  index: i,
  text: c.text,
  via: c.via,
  ...classifyCommand(c),
}))
if (options.only) commands = commands.filter((c) => c.text.includes(options.only))

// ---------------------------------------------------------------------------
// Execute (--execute only; --demo simulates)
// ---------------------------------------------------------------------------

function runCommand(command) {
  // Only node/npm-style invocations of repo scripts are executed; the dry-run
  // flag requirement was already enforced by classifyCommand.
  const [cmd, ...args] = command.text.split(/\s+/)
  const resolved = cmd.includes("/") && !cmd.startsWith("/") ? join(ROOT, cmd) : cmd
  const result = spawnSync(resolved, args, {
    cwd: ROOT,
    encoding: "utf8",
    timeout: options.timeout,
    maxBuffer: 16 * 1024 * 1024,
    shell: false,
  })
  const timedOut = result.error && result.error.code === "ETIMEDOUT"
  return {
    exitCode: result.status ?? (timedOut ? "timeout" : 1),
    ok: !timedOut && result.status === 0,
    stdout: (result.stdout ?? "").trim(),
    stderr: (result.stderr ?? "").trim(),
  }
}

const results = commands.map((c) => {
  if (!c.safe) return { ...c, status: "skipped", detail: c.reason }
  if (options.demo) {
    return { ...c, status: "demo-pass", detail: "simulated --dry-run success" }
  }
  if (!options.execute) {
    return { ...c, status: "planned", detail: "dry-run only — pass --execute to run" }
  }
  const r = runCommand(c)
  return {
    ...c,
    status: r.ok ? "pass" : "fail",
    exitCode: r.exitCode,
    detail: r.ok ? "exit 0" : `exit ${r.exitCode}`,
    stdout: r.stdout.slice(0, 2000),
    stderr: r.stderr.slice(0, 2000),
  }
})

const summary = {
  runbook: relPath,
  title: runbookTitle(markdown),
  mode: options.demo ? "demo" : options.execute ? "execute" : "dry-run",
  total: results.length,
  dryRunSafe: results.filter((r) => r.safe).length,
  executed: results.filter((r) => ["pass", "fail", "demo-pass"].includes(r.status)).length,
  failed: results.filter((r) => r.status === "fail").length,
  results,
}

if (options.json) {
  console.log(JSON.stringify(summary, null, 2))
} else {
  console.log(`# ${summary.title ?? relPath} — ${relPath}`)
  console.log(
    `mode: ${summary.mode} | ${summary.total} commands, ${summary.dryRunSafe} dry-run safe`,
  )
  console.log("")
  for (const r of results) {
    console.log(`[${r.status}] ${r.text}`)
    console.log(`    ${r.via} — ${r.safe ? "dry-run safe" : "plan only"}: ${r.detail}`)
  }
  if (!options.execute && !options.demo) {
    console.log("")
    console.log("Dry-run plan only. Re-run with --execute to run the safe commands,")
    console.log("or --demo to simulate them offline.")
  }
}

process.exit(summary.failed > 0 ? 1 : 0)
