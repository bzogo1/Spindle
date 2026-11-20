/**
 * Scheduler for the lab snapshot suite.
 *
 * Dependency-free interval runner: executes the snapshot diff CLI
 * (`scripts/lab-snapshot-diff.ts`, optionally via the sharded runner) on a
 * fixed interval or once, and appends each run's outcome to
 * `<root>/schedule-history.jsonl`.
 *
 * This is NOT a cron daemon — for production scheduling prefer cron/systemd:
 * see the "Scheduling" section of docs/lab-snapshots.md for ready-made
 * crontab and systemd timer snippets.
 *
 * Usage:
 *   tsx scripts/lab-schedule.ts --manifest <cases.json> [--once]
 *     [--interval-minutes <n>] [--workers <n>] [--dir <path>]
 *     [--update] [--threshold <f>] [--max-diff-ratio <f>] [--provider <name>]
 *
 * Options:
 *   --once               Run a single pass and exit (default when
 *                        --interval-minutes is omitted)
 *   --interval-minutes   Repeat every N minutes (min 1)
 *   --workers <n>        >1 → run via lab-snapshot-shard.ts with N workers
 *
 * Exit code: 0 when the run(s) pass; with --interval-minutes the process keeps
 * running and exits non-zero only on startup/manifest errors (per-run
 * failures are recorded, not fatal — the schedule must survive a red run).
 */

import { spawn } from "node:child_process"
import { appendFile, mkdir } from "node:fs/promises"
import { dirname, join } from "node:path"

interface CliOptions {
  manifest?: string
  once: boolean
  intervalMinutes?: number
  workers: number
  dir?: string
  update: boolean
  threshold?: number
  maxDiffRatio?: number
  provider?: string
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = { once: false, workers: 1, update: false }
  for (let i = 0; i < argv.length; i++) {
    const next = () => argv[++i]
    switch (argv[i]) {
      case "--manifest":
        opts.manifest = next()
        break
      case "--once":
        opts.once = true
        break
      case "--interval-minutes":
        opts.intervalMinutes = Number(next())
        break
      case "--workers":
        opts.workers = Math.max(1, Number(next()))
        break
      case "--dir":
        opts.dir = next()
        break
      case "--update":
        opts.update = true
        break
      case "--threshold":
        opts.threshold = Number(next())
        break
      case "--max-diff-ratio":
        opts.maxDiffRatio = Number(next())
        break
      case "--provider":
        opts.provider = next()
        break
      default:
        if (argv[i].startsWith("--")) throw new Error(`Unknown option: ${argv[i]}`)
    }
  }
  if (!opts.manifest) throw new Error("--manifest <path> is required")
  if (opts.intervalMinutes !== undefined && opts.intervalMinutes < 1) {
    throw new Error("--interval-minutes must be >= 1")
  }
  return opts
}

function runSuite(args: string[]): Promise<number> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn("npx", ["tsx", ...args], { stdio: "inherit", env: process.env })
    child.on("error", reject)
    child.on("exit", (code) => resolvePromise(code ?? 1))
  })
}

async function recordSchedule(
  dir: string | undefined,
  entry: Record<string, unknown>,
): Promise<void> {
  try {
    const root = dir ?? process.env.LAB_SNAPSHOT_DIR ?? ".lab-snapshots"
    const path = join(root, "schedule-history.jsonl")
    await mkdir(dirname(path), { recursive: true })
    await appendFile(path, `${JSON.stringify({ timestamp: new Date().toISOString(), ...entry })}\n`)
  } catch {
    // Advisory only.
  }
}

async function runOnce(cli: CliOptions): Promise<number> {
  const startedAt = Date.now()
  const script = cli.workers > 1 ? "scripts/lab-snapshot-shard.ts" : "scripts/lab-snapshot-diff.ts"
  const args = [script, "--manifest", cli.manifest!]
  if (cli.dir) args.push("--dir", cli.dir)
  if (cli.update) args.push("--update")
  if (cli.provider) args.push("--provider", cli.provider)
  if (cli.threshold !== undefined) args.push("--threshold", String(cli.threshold))
  if (cli.maxDiffRatio !== undefined) args.push("--max-diff-ratio", String(cli.maxDiffRatio))
  if (cli.workers > 1) args.push("--workers", String(cli.workers))

  const code = await runSuite(args)
  await recordSchedule(cli.dir, {
    kind: "snapshot-suite",
    pass: code === 0,
    exitCode: code,
    workers: cli.workers,
    durationMs: Date.now() - startedAt,
  })
  return code
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms))
}

async function main(): Promise<number> {
  const cli = parseArgs(process.argv.slice(2))
  cli.dir ??= process.env.LAB_SNAPSHOT_DIR
  cli.provider ??= process.env.LAB_SNAPSHOT_PROVIDER

  const intervalMs = cli.intervalMinutes ? cli.intervalMinutes * 60_000 : null

  if (intervalMs === null || cli.once) {
    // Single-shot mode (also the cron-friendly path).
    const code = await runOnce(cli)
    if (code !== 0) {
      console.error("Snapshot suite failed — see output above.")
      return 1
    }
    console.log("Snapshot suite passed.")
    return 0
  }

  // Interval mode: keep running; per-run failures are logged + recorded but
  // do not kill the scheduler.
  console.log(
    `Lab snapshot scheduler — every ${cli.intervalMinutes}min, ` +
      `${cli.workers > 1 ? `${cli.workers} workers` : "single process"}, manifest ${cli.manifest}`,
  )
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const code = await runOnce(cli)
    console.log(
      `[${new Date().toISOString()}] run finished (exit ${code}) — next in ${cli.intervalMinutes}min`,
    )
    await sleep(intervalMs)
  }
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(2)
  })
