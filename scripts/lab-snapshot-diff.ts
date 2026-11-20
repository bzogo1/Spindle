/**
 * CI entry point for lab run snapshot diffs.
 *
 * Usage:
 *   tsx scripts/lab-snapshot-diff.ts --manifest <cases.json> [options]
 *
 * Options:
 *   --manifest <path>     JSON manifest (required): { "cases": [...] }
 *   --update              Approve current captures as baselines instead of failing
 *   --dir <path>          Snapshot root (default .lab-snapshots or LAB_SNAPSHOT_DIR)
 *   --provider <name>     Default capture provider (default "mock" / LAB_SNAPSHOT_PROVIDER)
 *   --threshold <0-1>     Default per-pixel color threshold (default 0.1)
 *   --max-diff-ratio <f>  Default max diff pixel ratio for pass (default 0)
 *   --region-columns <n>  Emit per-region breakdown with n columns
 *   --shard <i>/<n>       Run only shard i of n (0-based; round-robin split of
 *                         the manifest — used by scripts/lab-snapshot-shard.ts)
 *
 * Manifest case shape:
 *   {
 *     "name": "tide-analysis",          // baseline name (required)
 *     "runId": "ci-run-1",              // artifact grouping (default: name)
 *     "config": { ... },                // anything affecting output → baseline key
 *     "params": { ... }, "toolId": "...",
 *     "viewport": {"width":800,"height":600}, "theme": "light",
 *     "baselineKey": "...",             // explicit key override
 *     "actual": "path/to.png",          // compare an existing PNG…
 *     "provider": "mock",               // …or capture via a provider (default)
 *     "image": "main",                  // which captured image to diff
 *     "maskRegions": [{"x":0,"y":0,"width":10,"height":10}],
 *     "threshold": 0.1, "maxDiffRatio": 0, "includeAA": false
 *   }
 *
 * Exit code: 0 when every case passes (or --update approves them), 1 otherwise.
 */

import { appendFile, mkdir, readFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"

import {
  compareSnapshots,
  computeBaselineKey,
  getSnapshotProvider,
  hasBaseline,
  readBaseline,
  snapshotRoot,
  writeBaseline,
  writeRunArtifact,
  type DiffOptions,
  type MaskRegion,
  type SnapshotCaptureRequest,
} from "../src/lib/lab-snapshots/index"

interface ManifestCase {
  name: string
  runId?: string
  config?: Record<string, unknown>
  params?: Record<string, unknown>
  toolId?: string
  viewport?: { width: number; height: number }
  theme?: string
  baselineKey?: string
  actual?: string
  provider?: string
  image?: string
  maskRegions?: MaskRegion[]
  threshold?: number
  maxDiffRatio?: number
  includeAA?: boolean
}

interface CliOptions {
  manifest?: string
  update: boolean
  dir?: string
  provider?: string
  threshold?: number
  maxDiffRatio?: number
  regionColumns?: number
  /** Run only shard `index` of `count` (0-based index, e.g. --shard 1/4). */
  shard?: { index: number; count: number }
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = { update: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const next = () => argv[++i]
    switch (arg) {
      case "--manifest":
        opts.manifest = next()
        break
      case "--update":
        opts.update = true
        break
      case "--dir":
        opts.dir = next()
        break
      case "--provider":
        opts.provider = next()
        break
      case "--threshold":
        opts.threshold = Number(next())
        break
      case "--max-diff-ratio":
        opts.maxDiffRatio = Number(next())
        break
      case "--region-columns":
        opts.regionColumns = Number(next())
        break
      case "--shard": {
        // Format: <index>/<count>, 0-based index (e.g. 0/4 … 3/4).
        const [index, count] = next().split("/").map(Number)
        if (
          !Number.isInteger(index) ||
          !Number.isInteger(count) ||
          count < 1 ||
          index < 0 ||
          index >= count
        ) {
          throw new Error(`Invalid --shard value (expected <index>/<count>, e.g. 0/4)`)
        }
        opts.shard = { index, count }
        break
      }
      default:
        if (arg.startsWith("--")) throw new Error(`Unknown option: ${arg}`)
    }
  }
  if (!opts.manifest) throw new Error("--manifest <path> is required")
  return opts
}

async function actualPngFor(
  testCase: ManifestCase,
  cli: CliOptions,
): Promise<{ png: Uint8Array; width: number; height: number }> {
  if (testCase.actual) {
    const data = await readFile(resolve(testCase.actual))
    // Decode lazily inside compareSnapshots; report size via pngjs-free header
    // parse is overkill — return 0s and let the diff validate dimensions.
    return { png: new Uint8Array(data), width: 0, height: 0 }
  }
  const request: SnapshotCaptureRequest = {
    runId: testCase.runId ?? `ci-${testCase.name}`,
    toolId: testCase.toolId,
    params: testCase.params,
    config: testCase.config,
  }
  const provider = getSnapshotProvider(testCase.provider ?? cli.provider)
  const result = await provider.capture(request)
  const image = result.images.find((img) => img.name === (testCase.image ?? result.images[0]?.name))
  if (!image) throw new Error(`Provider returned no image "${testCase.image ?? "main"}"`)
  return { png: image.png, width: image.width, height: image.height }
}

/** Append a run record to `<root>/history.jsonl` for flaky-test analysis
 * (`scripts/lab-flaky-report.ts`). Best-effort: never fails the run. */
async function recordHistory(
  dir: string | undefined,
  record: Record<string, unknown>,
): Promise<void> {
  try {
    const path = join(snapshotRoot(dir), "history.jsonl")
    await mkdir(dirname(path), { recursive: true })
    await appendFile(
      path,
      `${JSON.stringify({ timestamp: new Date().toISOString(), ...record })}\n`,
    )
  } catch {
    // History is advisory — ignore write failures.
  }
}

async function main(): Promise<number> {
  const cli = parseArgs(process.argv.slice(2))
  // Environment fallbacks are resolved here, at the entry point, so the
  // snapshot library under src/lib stays free of direct process.env reads.
  cli.dir ??= process.env.LAB_SNAPSHOT_DIR
  cli.provider ??= process.env.LAB_SNAPSHOT_PROVIDER
  const manifest = JSON.parse(await readFile(resolve(cli.manifest!), "utf8")) as {
    cases: ManifestCase[]
  }
  const root = snapshotRoot(cli.dir)
  console.log(`Lab snapshot diff — root: ${root}${cli.update ? " (update mode)" : ""}`)

  // --shard i/n: deterministic round-robin split of the manifest so N workers
  // cover disjoint case sets (see scripts/lab-snapshot-shard.ts).
  let cases = manifest.cases
  if (cli.shard) {
    cases = cases.filter((_, i) => i % cli.shard!.count === cli.shard!.index)
    console.log(
      `Shard ${cli.shard.index}/${cli.shard.count}: ${cases.length} of ${manifest.cases.length} case(s)`,
    )
  }

  let failures = 0
  for (const testCase of cases) {
    const runId = testCase.runId ?? `ci-${testCase.name}`
    const key =
      testCase.baselineKey ??
      computeBaselineKey({
        name: testCase.name,
        config: testCase.config,
        viewport: testCase.viewport,
        theme: testCase.theme,
      })
    const diffOptions: DiffOptions = {
      threshold: testCase.threshold ?? cli.threshold ?? 0.1,
      maxDiffRatio: testCase.maxDiffRatio ?? cli.maxDiffRatio ?? 0,
      includeAA: testCase.includeAA ?? false,
      maskRegions: testCase.maskRegions,
      regionColumns: cli.regionColumns,
    }

    const caseStart = Date.now()
    try {
      const actual = await actualPngFor(testCase, cli)
      const has = await hasBaseline(key, cli.dir)

      if (cli.update) {
        const path = await writeBaseline(key, actual.png, cli.dir)
        await writeRunArtifact(runId, testCase.name, "actual", actual.png, cli.dir)
        console.log(`${has ? "updated" : "created"} baseline ${key} → ${path}`)
        continue
      }

      if (!has) {
        failures++
        console.error(`FAIL ${testCase.name}: no baseline for ${key} — approve with --update`)
        await recordHistory(cli.dir, {
          caseName: testCase.name,
          runId,
          pass: false,
          diffRatio: 0,
          reason: "no-baseline",
          durationMs: Date.now() - caseStart,
        })
        continue
      }

      const baseline = await readBaseline(key, cli.dir)
      const result = compareSnapshots(actual.png, baseline, diffOptions)
      await writeRunArtifact(runId, testCase.name, "actual", actual.png, cli.dir)
      await writeRunArtifact(runId, testCase.name, "diff", result.diffPng, cli.dir)
      await writeRunArtifact(runId, testCase.name, "baseline", baseline, cli.dir)

      const pct = (result.diffRatio * 100).toFixed(3)
      const status = result.pass ? "PASS" : "FAIL"
      console.log(
        `${status} ${testCase.name} (${key}): ${result.diffPixels}/${result.totalPixels} px differ (${pct}%)`,
      )
      if (!result.pass) failures++
      await recordHistory(cli.dir, {
        caseName: testCase.name,
        runId,
        pass: result.pass,
        diffPixels: result.diffPixels,
        totalPixels: result.totalPixels,
        diffRatio: result.diffRatio,
        durationMs: Date.now() - caseStart,
      })
    } catch (error) {
      failures++
      const message = error instanceof Error ? error.message : String(error)
      console.error(`ERROR ${testCase.name}: ${message}`)
      await recordHistory(cli.dir, {
        caseName: testCase.name,
        runId,
        pass: false,
        diffRatio: 0,
        reason: "error",
        error: message,
        durationMs: Date.now() - caseStart,
      })
    }
  }

  if (failures > 0) {
    console.error(`\n${failures} snapshot case(s) failed.`)
    return 1
  }
  console.log("\nAll snapshot cases passed.")
  return 0
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(2)
  })
