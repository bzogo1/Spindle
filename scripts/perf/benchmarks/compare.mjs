#!/usr/bin/env node
// Compare benchmark snapshots against a stored baseline and enforce budgets.
//
//   node scripts/perf/benchmarks/compare.mjs baseline [--name <name>] [--demo]
//   node scripts/perf/benchmarks/compare.mjs diff [--baseline <name|file>]
//       [--current <file>] [--runtime <file>]
//   node scripts/perf/benchmarks/compare.mjs check [same options as diff]
//       [--threshold <pct>] [--require-runtime]
//   node scripts/perf/benchmarks/compare.mjs demo
//
// `check` exits 0 on PASS, 1 on regression/budget breach, 2 on usage errors —
// suitable for CI gating. `demo` runs the whole workflow on synthetic data,
// fully offline, and always exits 0.

import { existsSync, mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  BASELINES_DIR,
  collectDemo,
  collectSnapshot,
  diffSnapshots,
  formatDiff,
  latestBaseline,
  loadBudgets,
  writeSnapshot,
} from "./lib/core.mjs"

const USAGE = `Usage: node scripts/perf/benchmarks/compare.mjs <command> [options]

Commands:
  baseline   Collect a snapshot and store it as benchmarks/baselines/<name>.json
             (default name: main)
  diff       Print a metric-by-metric diff of current vs baseline (always exit 0)
  check      Like diff, but exit 1 when a regression exceeds the threshold or a
             budget is breached (CI gate)
  demo       Run baseline + check end-to-end on synthetic data (offline)

Options:
  --name <name>        Baseline name for 'baseline' (default: main)
  --baseline <name>    Baseline name or JSON file for diff/check (default: main)
  --current <file>     Snapshot JSON to compare (default: collect from .next)
  --runtime <file>     Runtime metrics JSON to embed when collecting
  --demo               Use synthetic data instead of the .next build
  --demo-seed <n>      Seed for --demo data (default: 42)
  --threshold <pct>    Override budgets.json regression percent for this run
  --require-runtime    Fail check when the snapshot has no runtime metrics
  --help               Show this help
`

function parseArgs(argv) {
  const args = { _: [] }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (!arg.startsWith("--")) {
      args._.push(arg)
      continue
    }
    const eq = arg.indexOf("=")
    if (eq !== -1) {
      args[arg.slice(2, eq)] = arg.slice(eq + 1)
    } else if (["demo", "help", "require-runtime", "pretty"].includes(arg.slice(2))) {
      args[arg.slice(2)] = true
    } else {
      args[arg.slice(2)] = argv[++i]
    }
  }
  return args
}

function loadJsonFile(path, label) {
  if (!existsSync(path)) throw new Error(`${label} not found: ${path}`)
  return JSON.parse(readFileSync(path, "utf8"))
}

function resolveBaselinePath(arg) {
  if (!arg || arg === true) return latestBaseline("main")
  if (arg.endsWith(".json") && existsSync(arg)) return arg
  if (existsSync(join(BASELINES_DIR, `${arg}.json`))) {
    return join(BASELINES_DIR, `${arg}.json`)
  }
  if (existsSync(arg)) return arg
  return latestBaseline(arg)
}

function resolveCurrent(args) {
  if (args.current) return loadJsonFile(args.current, "current snapshot")
  return collectSnapshot({
    demo: Boolean(args.demo),
    runtimePath: args.runtime ?? null,
    demoSeed: args["demo-seed"] != null ? Number(args["demo-seed"]) : 42,
  })
}

function runCompare(args, { check = false } = {}) {
  const baselinePath = resolveBaselinePath(args.baseline)
  const baseline = loadJsonFile(baselinePath, "baseline snapshot")
  const current = resolveCurrent(args)

  const budgets = loadBudgets()
  if (args.threshold != null) {
    budgets.regression.percent = Number(args.threshold)
  }

  if (check && args["require-runtime"] && !current.runtime) {
    console.error("check: current snapshot has no runtime metrics (--require-runtime)")
    return 2
  }

  const result = diffSnapshots(baseline, current, budgets)
  console.log(
    formatDiff(result, {
      baselineLabel: baselinePath,
      currentLabel: args.current ?? `live (${current.source})`,
    }),
  )
  return check && result.failures.length > 0 ? 1 : 0
}

function cmdBaseline(args) {
  const name = typeof args.name === "string" ? args.name : "main"
  const snapshot = collectSnapshot({
    demo: Boolean(args.demo),
    runtimePath: args.runtime ?? null,
    demoSeed: args["demo-seed"] != null ? Number(args["demo-seed"]) : 42,
  })
  const path = writeSnapshot(snapshot, BASELINES_DIR, name)
  console.log(`Baseline "${name}" written to ${path}`)
  return 0
}

function cmdDemo() {
  // Fully offline end-to-end: synthetic baseline + two current scenarios.
  const dir = mkdtempSync(join(tmpdir(), "spindle-bench-demo-"))
  const baseline = collectDemo({ seed: 42 })
  const baselinePath = writeSnapshot(baseline, dir, "baseline")

  console.log("== demo: capture baseline (synthetic) ==")
  console.log(`  wrote ${baselinePath}`)
  console.log("")

  // Scenario A: within thresholds -> PASS.
  const clean = collectDemo({ seed: 7, jitter: 0.01 })
  const cleanPath = writeSnapshot(clean, dir, "current-clean")
  console.log("== demo: check, current within thresholds ==")
  const cleanResult = diffSnapshots(baseline, clean, loadBudgets())
  console.log(formatDiff(cleanResult, { baselineLabel: "baseline", currentLabel: cleanPath }))
  console.log("")

  // Scenario B: injected +20% on /docs/[slug] -> FAIL (illustrative; must
  // clear the +5% + 25 kB slack in budgets.json to register).
  const regressed = collectDemo({ seed: 7, jitter: 0.01, overrides: { "/docs/[slug]": 20 } })
  const regressedPath = writeSnapshot(regressed, dir, "current-regressed")
  console.log("== demo: check, injected +20% regression on /docs/[slug] ==")
  const badResult = diffSnapshots(baseline, regressed, loadBudgets())
  console.log(formatDiff(badResult, { baselineLabel: "baseline", currentLabel: regressedPath }))
  console.log("")
  console.log("Demo exit code is always 0; a real `check` run exits 1 when failures exist.")
  return 0
}

function main() {
  const argv = process.argv.slice(2)
  const args = parseArgs(argv)
  const command = args._[0]

  if (args.demo && !command) return cmdDemo()

  if (!command || args.help) {
    console.log(USAGE)
    return command ? 0 : 2
  }

  switch (command) {
    case "baseline":
      return cmdBaseline(args)
    case "diff":
      return runCompare(args, { check: false })
    case "check":
      return runCompare(args, { check: true })
    case "demo":
      return cmdDemo()
    default:
      console.error(`compare: unknown command "${command}"`)
      console.log(USAGE)
      return 2
  }
}

try {
  process.exitCode = main()
} catch (error) {
  console.error(`compare: ${error.message}`)
  process.exitCode = 2
}
