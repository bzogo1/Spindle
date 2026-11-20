/**
 * Parallel/sharded runner for the lab snapshot suite.
 *
 * Splits a manifest's cases across N workers by invoking
 * `scripts/lab-snapshot-diff.ts --shard i/N` once per worker (concurrently via
 * child processes), then merges the exit codes. Each shard writes its own
 * run artifacts and appends to the shared `history.jsonl` (append-only, safe
 * under concurrency for line-sized writes).
 *
 * Usage:
 *   tsx scripts/lab-snapshot-shard.ts --manifest <cases.json> [--workers <n>]
 *     [--dir <path>] [--update] [--threshold <f>] [--max-diff-ratio <f>]
 *     [--provider <name>] [--region-columns <n>]
 *
 * Options:
 *   --workers <n>   Number of parallel shards (default 4, capped at case count)
 *
 * Exit code: 0 when every shard passes, 1 otherwise.
 */

import { spawn } from "node:child_process"
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"

interface CliOptions {
  manifest?: string
  workers: number
  dir?: string
  update: boolean
  threshold?: number
  maxDiffRatio?: number
  provider?: string
  regionColumns?: number
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = { workers: 4, update: false }
  for (let i = 0; i < argv.length; i++) {
    const next = () => argv[++i]
    switch (argv[i]) {
      case "--manifest":
        opts.manifest = next()
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
      case "--region-columns":
        opts.regionColumns = Number(next())
        break
      default:
        if (argv[i].startsWith("--")) throw new Error(`Unknown option: ${argv[i]}`)
    }
  }
  if (!opts.manifest) throw new Error("--manifest <path> is required")
  return opts
}

function runShard(args: string[]): Promise<number> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn("npx", ["tsx", "scripts/lab-snapshot-diff.ts", ...args], {
      stdio: "inherit",
      env: process.env,
    })
    child.on("error", reject)
    child.on("exit", (code) => resolvePromise(code ?? 1))
  })
}

async function main(): Promise<number> {
  const cli = parseArgs(process.argv.slice(2))
  cli.dir ??= process.env.LAB_SNAPSHOT_DIR
  cli.provider ??= process.env.LAB_SNAPSHOT_PROVIDER

  const manifest = JSON.parse(await readFile(resolve(cli.manifest!), "utf8")) as {
    cases: unknown[]
  }
  const caseCount = manifest.cases?.length ?? 0
  if (caseCount === 0) {
    console.log("Manifest has no cases — nothing to shard.")
    return 0
  }

  const workers = Math.min(cli.workers, caseCount)
  console.log(`Sharded snapshot run: ${caseCount} case(s) across ${workers} worker(s)`)

  const sharedArgs: string[] = ["--manifest", resolve(cli.manifest!)]
  if (cli.dir) sharedArgs.push("--dir", cli.dir)
  if (cli.update) sharedArgs.push("--update")
  if (cli.provider) sharedArgs.push("--provider", cli.provider)
  if (cli.threshold !== undefined) sharedArgs.push("--threshold", String(cli.threshold))
  if (cli.maxDiffRatio !== undefined) sharedArgs.push("--max-diff-ratio", String(cli.maxDiffRatio))
  if (cli.regionColumns !== undefined)
    sharedArgs.push("--region-columns", String(cli.regionColumns))

  const results = await Promise.all(
    Array.from({ length: workers }, (_, i) =>
      runShard([...sharedArgs, "--shard", `${i}/${workers}`]),
    ),
  )

  const failedShards = results.filter((code) => code !== 0)
  if (failedShards.length > 0) {
    console.error(`\n${failedShards.length}/${workers} shard(s) failed.`)
    return 1
  }
  console.log("\nAll shards passed.")
  return 0
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(2)
  })
