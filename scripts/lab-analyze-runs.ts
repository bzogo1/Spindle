/**
 * Post-run analyzer for lab snapshot artifacts.
 *
 * Scans `<root>/runs/<runId>/` for `*-actual.png` + `*-baseline.png` pairs,
 * re-runs the pixel diff, heuristic analysis, and perceptual comparison, and
 * writes `<name>-analysis.json` next to the artifacts plus a combined
 * `<root>/analysis-report.json`.
 *
 * Usage:
 *   tsx scripts/lab-analyze-runs.ts [--dir <path>] [--run <runId>] [--grid <n>]
 *
 * Options:
 *   --dir <path>   Snapshot root (default .lab-snapshots or LAB_SNAPSHOT_DIR)
 *   --run <id>     Only analyze this runId (default: all runs)
 *   --grid <n>     Heatmap/analysis grid columns (default 16)
 */

import { readdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"

import {
  analyzeSnapshotDiff,
  comparePerceptual,
  compareSnapshots,
  snapshotRoot,
  type DiffResult,
  type PerceptualResult,
  type SnapshotAnalysis,
} from "../src/lib/lab-snapshots/index"

interface CliOptions {
  dir?: string
  run?: string
  grid: number
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = { grid: 16 }
  for (let i = 0; i < argv.length; i++) {
    const next = () => argv[++i]
    switch (argv[i]) {
      case "--dir":
        opts.dir = next()
        break
      case "--run":
        opts.run = next()
        break
      case "--grid":
        opts.grid = Number(next())
        break
      default:
        if (argv[i].startsWith("--")) throw new Error(`Unknown option: ${argv[i]}`)
    }
  }
  return opts
}

async function listDir(path: string): Promise<string[]> {
  try {
    return await readdir(path)
  } catch {
    return []
  }
}

async function main(): Promise<number> {
  const cli = parseArgs(process.argv.slice(2))
  cli.dir ??= process.env.LAB_SNAPSHOT_DIR
  const root = snapshotRoot(cli.dir)
  const runsDir = join(root, "runs")

  let runIds = await listDir(runsDir)
  if (cli.run) runIds = runIds.filter((r) => r === cli.run)
  if (runIds.length === 0) {
    console.log(`No runs found under ${runsDir}`)
    return 0
  }

  const report: Record<string, unknown>[] = []

  for (const runId of runIds) {
    const runDir = join(runsDir, runId)
    const files = await listDir(runDir)
    const actuals = files.filter((f) => f.endsWith("-actual.png"))

    for (const actualFile of actuals) {
      const name = actualFile.slice(0, -"-actual.png".length)
      const baselineFile = `${name}-baseline.png`
      if (!files.includes(baselineFile)) continue

      const actual = new Uint8Array(await readFile(join(runDir, actualFile)))
      const baseline = new Uint8Array(await readFile(join(runDir, baselineFile)))

      let diff: DiffResult | null = null
      let analysis: SnapshotAnalysis | null = null
      let perceptual: PerceptualResult | null = null
      let error: string | null = null
      try {
        diff = compareSnapshots(actual, baseline, { regionColumns: 4 })
        analysis = analyzeSnapshotDiff(diff, { name, gridColumns: cli.grid })
        perceptual = comparePerceptual(actual, baseline, { gridColumns: cli.grid })
      } catch (e) {
        error = e instanceof Error ? e.message : String(e)
      }

      const entry = {
        runId,
        name,
        error,
        diff: diff
          ? {
              pass: diff.pass,
              diffPixels: diff.diffPixels,
              totalPixels: diff.totalPixels,
              diffRatio: diff.diffRatio,
            }
          : null,
        analysis: analysis
          ? {
              significance: analysis.significance,
              categories: analysis.categories,
              summary: analysis.summary,
            }
          : null,
        perceptual: perceptual
          ? {
              pixelDiffRatio: perceptual.pixelDiffRatio,
              meanLuminanceDelta: perceptual.meanLuminanceDelta,
              ssim: perceptual.ssim,
            }
          : null,
      }
      report.push(entry)

      await writeFile(join(runDir, `${name}-analysis.json`), JSON.stringify(entry, null, 2))

      const sig = analysis ? `significance ${analysis.significance}/100` : "analysis failed"
      console.log(`${runId}/${name}: ${sig}${error ? ` — ${error}` : ""}`)
    }
  }

  const outPath = join(root, "analysis-report.json")
  await writeFile(
    outPath,
    JSON.stringify({ generatedAt: new Date().toISOString(), cases: report }, null, 2),
  )
  console.log(`\nWrote ${report.length} case analysis(es) → ${outPath}`)
  return 0
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(2)
  })
