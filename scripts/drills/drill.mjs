#!/usr/bin/env node
// Disaster-recovery drill runner for Spindle.
//
//   node scripts/drills/drill.mjs [options]
//
// Orchestrates LOCAL-SAFE DR drills by delegating to the existing scripts in
// their dry-run / plan modes — it never reimplements restore, rollback, or
// secret logic. Each scenario in scripts/drills/scenarios.json produces a
// pass/fail verdict plus elapsed time; the elapsed time is the RTO proxy that
// a real drill against staging measures against `rtoTargetSeconds`.
//
// Options:
//   --demo               simulate every scenario offline (no commands run);
//                        honors DRILL_DEMO_FAIL=<id[,id...]> to force failures
//   --scenario <id>      run only the named scenario (repeatable or comma list)
//   --list               list scenarios and exit
//   --json               print only the JSON report
//   --timeout <ms>       per-scenario timeout (default 120000)
//   -h, --help           show this help
//
// Exit codes: 0 all scenarios passed (or --demo/--list), 1 at least one
// scenario failed or timed out, 2 usage error.
//
// Real drills: see docs/resilience/disaster-recovery.md — the same scenarios
// run without dry-run flags on the staging host measure actual RTO.

import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { env } from "node:process"

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const SCENARIOS_FILE = join(ROOT, "scripts", "drills", "scenarios.json")
const MAX_BUFFER = 32 * 1024 * 1024

const USAGE = `Usage: node scripts/drills/drill.mjs [options]

Options:
  --demo               simulate all scenarios offline; no commands execute
  --scenario <id>      run only named scenario(s); repeatable or comma list
  --list               list scenarios and exit
  --json               print only the JSON report
  --timeout <ms>       per-scenario timeout in ms (default 120000)
  -h, --help           show this help

Environment:
  DRILL_DEMO_FAIL      comma-separated scenario ids to simulate as failures
                       in --demo mode (used to exercise the failure path)

Exit codes: 0 pass/demo/list, 1 failure, 2 usage error.`

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const options = { demo: false, json: false, list: false, help: false, timeout: 120000 }
  const scenarios = []
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const next = () => argv[++i]
    switch (arg) {
      case "--demo":
        options.demo = true
        break
      case "--json":
        options.json = true
        break
      case "--list":
        options.list = true
        break
      case "--help":
      case "-h":
        options.help = true
        break
      case "--scenario": {
        const value = next()
        if (!value) usageError("--scenario requires a scenario id")
        scenarios.push(
          ...value
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        )
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
        usageError(`Unknown argument: ${arg}`)
    }
  }
  options.scenarios = scenarios
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
// Scenario loading
// ---------------------------------------------------------------------------

let catalog
try {
  catalog = JSON.parse(readFileSync(SCENARIOS_FILE, "utf8"))
} catch (error) {
  console.error(`error: could not load ${SCENARIOS_FILE}: ${error.message}`)
  process.exit(2)
}

const all = catalog.scenarios ?? []
const byId = new Map(all.map((s) => [s.id, s]))

if (options.list) {
  for (const s of all) {
    console.log(
      `${s.id.padEnd(20)} ${s.category.padEnd(14)} rto=${s.rtoTargetSeconds}s  ${s.title}`,
    )
  }
  process.exit(0)
}

let selected = all
if (options.scenarios.length > 0) {
  const unknown = options.scenarios.filter((id) => !byId.has(id))
  if (unknown.length > 0) {
    usageError(`unknown scenario(s): ${unknown.join(", ")} (see --list)`)
  }
  const wanted = new Set(options.scenarios)
  selected = all.filter((s) => wanted.has(s.id))
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

function formatDuration(ms) {
  if (ms < 1000) return `${ms.toFixed(0)}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function formatTarget(seconds) {
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`
  return `${(seconds / 3600).toFixed(1)}h`
}

// Resolve a command entrypoint: bare names go through PATH; anything with a
// slash is resolved against the repo root so "./node_modules/.bin/tsx" works
// regardless of the caller's cwd.
function resolveCommand(command) {
  const [cmd, ...args] = command
  const resolved = cmd.includes("/") && !cmd.startsWith("/") ? join(ROOT, cmd) : cmd
  return [resolved, args]
}

function runScenario(scenario) {
  const [cmd, args] = resolveCommand(scenario.command)
  const started = performance.now()
  const result = spawnSync(cmd, args, {
    cwd: ROOT,
    encoding: "utf8",
    timeout: options.timeout,
    maxBuffer: MAX_BUFFER,
  })
  const elapsedMs = performance.now() - started

  const timedOut = result.error && result.error.code === "ETIMEDOUT"
  const exitCode = result.status ?? 1
  const ok = !timedOut && exitCode === 0

  return {
    id: scenario.id,
    title: scenario.title,
    category: scenario.category,
    status: ok ? "pass" : "fail",
    exitCode: timedOut ? "timeout" : exitCode,
    elapsedMs,
    rtoTargetSeconds: scenario.rtoTargetSeconds ?? null,
    withinTarget: scenario.rtoTargetSeconds ? elapsedMs / 1000 <= scenario.rtoTargetSeconds : null,
    command: [cmd, ...args].join(" "),
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: timedOut
      ? `timed out after ${options.timeout}ms`
      : result.error
        ? String(result.error.message ?? result.error)
        : "",
  }
}

// Deterministic pseudo-duration for --demo so output is stable run to run.
function demoDurationMs(id, index) {
  let hash = 0
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
  return 120 + (hash % 380) + index * 17
}

function runDemo() {
  const forcedFailures = new Set(
    (env.DRILL_DEMO_FAIL ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  )
  const results = []
  selected.forEach((scenario, index) => {
    const fail = forcedFailures.has(scenario.id)
    const elapsedMs = demoDurationMs(scenario.id, index)
    results.push({
      id: scenario.id,
      title: scenario.title,
      category: scenario.category,
      status: fail ? "fail" : "pass",
      exitCode: fail ? 1 : 0,
      elapsedMs,
      rtoTargetSeconds: scenario.rtoTargetSeconds ?? null,
      withinTarget: scenario.rtoTargetSeconds
        ? elapsedMs / 1000 <= scenario.rtoTargetSeconds
        : null,
      command: `[demo] would run: ${scenario.command.join(" ")}`,
      stdout: "",
      stderr: "",
      error: fail ? "simulated failure (DRILL_DEMO_FAIL)" : "",
      simulated: true,
    })
  })
  return results
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

function printResult(result) {
  const tag = result.status === "pass" ? "PASS" : "FAIL"
  console.log(`\n== ${result.id}: ${result.title} ==`)
  console.log(
    `   category: ${result.category}   rto target: ${result.rtoTargetSeconds ? formatTarget(result.rtoTargetSeconds) : "n/a"}`,
  )
  console.log(`   command:  ${result.command}`)
  if (result.stdout)
    process.stdout.write(result.stdout.endsWith("\n") ? result.stdout : `${result.stdout}\n`)
  if (result.stderr)
    process.stderr.write(result.stderr.endsWith("\n") ? result.stderr : `${result.stderr}\n`)
  const targetNote =
    result.rtoTargetSeconds == null
      ? ""
      : result.withinTarget
        ? ` — within RTO target (${formatTarget(result.rtoTargetSeconds)})`
        : ` — EXCEEDS RTO target (${formatTarget(result.rtoTargetSeconds)})`
  if (result.error) console.log(`   error: ${result.error}`)
  console.log(
    `   ${tag} in ${formatDuration(result.elapsedMs)}${targetNote}${result.simulated ? "  [simulated]" : ""}`,
  )
}

function buildReport(results, demo) {
  const passed = results.filter((r) => r.status === "pass").length
  const failed = results.length - passed
  const totalMs = results.reduce((sum, r) => sum + r.elapsedMs, 0)
  return {
    drill: "disaster-recovery",
    mode: demo ? "demo" : "dry-run",
    ranAt: new Date().toISOString(),
    scenarios: results.map((r) => ({
      id: r.id,
      title: r.title,
      category: r.category,
      status: r.status,
      exitCode: r.exitCode,
      elapsedMs: Math.round(r.elapsedMs),
      rtoTargetSeconds: r.rtoTargetSeconds,
      withinTarget: r.withinTarget,
      command: r.command,
      error: r.error,
      simulated: r.simulated ?? false,
    })),
    summary: {
      total: results.length,
      passed,
      failed,
      totalElapsedMs: Math.round(totalMs),
      allWithinTarget: results.every((r) => r.withinTarget !== false),
    },
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const started = performance.now()
const results = options.demo ? runDemo() : selected.map(runScenario)
const report = buildReport(results, options.demo)

if (options.json) {
  console.log(JSON.stringify(report, null, 2))
} else {
  if (options.demo) console.log("[drill] DEMO MODE — scenarios simulated, no commands executed\n")
  else console.log(`[drill] running ${results.length} scenario(s) in local-safe dry-run mode\n`)
  for (const result of results) printResult(result)
  console.log(
    `\n[drill] summary: ${report.summary.passed}/${report.summary.total} passed` +
      ` in ${formatDuration(performance.now() - started)}` +
      (report.summary.failed > 0 ? ` — ${report.summary.failed} FAILED` : ""),
  )
}

process.exitCode = report.summary.failed > 0 ? 1 : 0
