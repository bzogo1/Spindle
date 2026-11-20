#!/usr/bin/env node
// Collect a performance benchmark snapshot.
//
//   node scripts/perf/benchmarks/bench.mjs [--demo] [--runtime <file.json>]
//       [--name <name>] [--out <dir|file>] [--pretty]
//
// Reads the current `.next` build (requires `npm run build` first) and emits a
// JSON snapshot: static asset totals, per-route client chunk bytes parsed from
// the app-path + client-reference manifests, and optional runtime metrics.
// `--demo` emits deterministic synthetic data instead, for offline use.

import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import { SNAPSHOTS_DIR, collectSnapshot, summarizeSnapshot, writeSnapshot } from "./lib/core.mjs"

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
    } else if (["demo", "pretty", "help"].includes(arg.slice(2))) {
      args[arg.slice(2)] = true
    } else {
      args[arg.slice(2)] = argv[++i]
    }
  }
  return args
}

const USAGE = `Usage: node scripts/perf/benchmarks/bench.mjs [options]

Options:
  --demo               Emit synthetic snapshot data (no .next build needed)
  --demo-seed <n>      Seed for --demo data (default: 42)
  --runtime <file>     JSON file with runtime metrics (ttfbMs, fcpMs, lcpMs,
                       tbtMs, cls, inpMs) to embed in the snapshot
  --name <name>        Snapshot name (default: snapshot-<timestamp>)
  --out <dir|file>     Write snapshot JSON here (default: benchmarks/snapshots/)
  --pretty             Pretty-print summary to stdout as well
  --help               Show this help
`

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log(USAGE)
    return
  }

  const snapshot = collectSnapshot({
    demo: Boolean(args.demo),
    runtimePath: args.runtime ?? null,
    demoSeed: args["demo-seed"] != null ? Number(args["demo-seed"]) : 42,
  })

  const out = args.out ?? SNAPSHOTS_DIR
  let outPath
  if (existsSync(out) && !out.endsWith(".json")) {
    outPath = writeSnapshot(snapshot, out, args.name)
  } else {
    // Treat --out as an exact file path.
    mkdirSync(dirname(out), { recursive: true })
    writeFileSync(out, JSON.stringify(snapshot, null, 2) + "\n")
    outPath = out
  }

  console.log(`Snapshot written to ${outPath}`)
  console.log(JSON.stringify(summarizeSnapshot(snapshot), null, args.pretty ? 2 : 0))
}

try {
  main()
} catch (error) {
  console.error(`bench: ${error.message}`)
  process.exit(2)
}
