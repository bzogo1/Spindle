/**
 * Flaky-test detection for lab snapshot runs.
 *
 * Consumes run records (one per executed case — see `SnapshotRunRecord`) and
 * produces per-case stability reports plus a quarantine recommendation.
 * Used by `scripts/lab-flaky-report.ts`; records are appended to
 * `.lab-snapshots/history.jsonl` by `scripts/lab-snapshot-diff.ts`.
 */

export interface SnapshotRunRecord {
  /** Manifest case name. */
  caseName: string
  /** Run/artifact grouping id. */
  runId?: string
  /** Whether the comparison passed. */
  pass: boolean
  /** diffPixels / totalPixels observed (0–1). */
  diffRatio: number
  /** Capture+compare wall time, when known. */
  durationMs?: number
  /** ISO timestamp or epoch ms. */
  timestamp?: string | number
  /** Retry/attempt count for this record, when the harness retried. */
  attempts?: number
}

export type FlakyVerdict = "stable" | "watch" | "flaky" | "quarantined"

export interface FlakyCaseReport {
  caseName: string
  runs: number
  passes: number
  failures: number
  /** passes / runs (0–1). */
  passRate: number
  meanDiffRatio: number
  /** Population stddev of diffRatio — instability signal. */
  diffRatioStddev: number
  /** Coefficient of variation (stddev/mean) — scale-free instability. */
  diffRatioCv: number
  /** Max observed diffRatio. */
  maxDiffRatio: number
  /** 0–100: higher = flakier. */
  flakyScore: number
  verdict: FlakyVerdict
  reasons: string[]
}

export interface FlakinessReport {
  cases: FlakyCaseReport[]
  /** Case names recommended for quarantine. */
  quarantine: string[]
  summary: string[]
  generatedAt: string
}

export interface FlakyOptions {
  /** Minimum runs before a case can be judged. Default 3. */
  minRuns?: number
  /** passRate below this → "flaky". Default 0.8. */
  flakyPassRate?: number
  /** diffRatioCv above this → "flaky". Default 0.5. */
  flakyCv?: number
  /** Cases explicitly quarantined upstream are reported as such. */
  alreadyQuarantined?: string[]
}

const DEFAULT_MIN_RUNS = 3
const DEFAULT_FLAKY_PASS_RATE = 0.8
const DEFAULT_FLAKY_CV = 0.5

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length
}

function stddev(values: number[]): number {
  if (values.length < 2) return 0
  const m = mean(values)
  const variance = values.reduce((sum, v) => sum + (v - m) * (v - m), 0) / values.length
  return Math.sqrt(variance)
}

/**
 * Analyze run records grouped by case name. Records may arrive in any order;
 * duplicates across runs are all counted.
 */
export function analyzeFlakiness(
  records: SnapshotRunRecord[],
  options: FlakyOptions = {},
): FlakinessReport {
  const minRuns = options.minRuns ?? DEFAULT_MIN_RUNS
  const flakyPassRate = options.flakyPassRate ?? DEFAULT_FLAKY_PASS_RATE
  const flakyCv = options.flakyCv ?? DEFAULT_FLAKY_CV
  const quarantinedSet = new Set(options.alreadyQuarantined ?? [])

  const byCase = new Map<string, SnapshotRunRecord[]>()
  for (const r of records) {
    const list = byCase.get(r.caseName) ?? []
    list.push(r)
    byCase.set(r.caseName, list)
  }

  const cases: FlakyCaseReport[] = [...byCase.entries()]
    .map(([caseName, runs]) => {
      const passes = runs.filter((r) => r.pass).length
      const ratios = runs.map((r) => r.diffRatio)
      const passRate = runs.length === 0 ? 1 : passes / runs.length
      const meanRatio = mean(ratios)
      const sd = stddev(ratios)
      const cv = meanRatio === 0 ? (sd === 0 ? 0 : Infinity) : sd / meanRatio
      const reasons: string[] = []

      if (runs.length < minRuns) {
        reasons.push(`only ${runs.length} run(s) recorded — needs ≥ ${minRuns} for a verdict`)
      }
      if (passRate < flakyPassRate) {
        reasons.push(`pass rate ${(passRate * 100).toFixed(0)}% < ${flakyPassRate * 100}%`)
      }
      if (Number.isFinite(cv) && cv > flakyCv && runs.length >= minRuns) {
        reasons.push(`diff-ratio variance high (CV ${cv.toFixed(2)} > ${flakyCv})`)
      }
      const retried = runs.filter((r) => (r.attempts ?? 1) > 1).length
      if (retried > 0) {
        reasons.push(`${retried} run(s) needed retries`)
      }

      // Flaky score: blend failure rate and instability.
      const failComponent = (1 - passRate) * 60
      const cvComponent = Number.isFinite(cv) ? Math.min(40, cv * 40) : sd > 0 ? 40 : 0
      const flakyScore = Math.round(Math.min(100, failComponent + cvComponent))

      let verdict: FlakyVerdict
      if (quarantinedSet.has(caseName)) {
        verdict = "quarantined"
      } else if (
        runs.length >= minRuns &&
        (passRate < flakyPassRate || (Number.isFinite(cv) && cv > flakyCv))
      ) {
        verdict = "flaky"
      } else if (runs.length < minRuns || passRate < 1 || cv > flakyCv / 2) {
        verdict = "watch"
      } else {
        verdict = "stable"
      }

      return {
        caseName,
        runs: runs.length,
        passes,
        failures: runs.length - passes,
        passRate,
        meanDiffRatio: meanRatio,
        diffRatioStddev: sd,
        diffRatioCv: Number.isFinite(cv) ? cv : Number.MAX_VALUE,
        maxDiffRatio: Math.max(...ratios),
        flakyScore,
        verdict,
        reasons,
      }
    })
    .sort((a, b) => b.flakyScore - a.flakyScore)

  const quarantine = cases.filter((c) => c.verdict === "flaky").map((c) => c.caseName)

  const summary: string[] = []
  const flakyCount = cases.filter((c) => c.verdict === "flaky").length
  const watchCount = cases.filter((c) => c.verdict === "watch").length
  summary.push(
    `${cases.length} case(s) analyzed: ${cases.length - flakyCount - watchCount} stable, ${watchCount} on watch, ${flakyCount} flaky.`,
  )
  if (quarantine.length > 0) {
    summary.push(`Quarantine candidates: ${quarantine.join(", ")}`)
  }

  return { cases, quarantine, summary, generatedAt: new Date().toISOString() }
}

/** Parse `.lab-snapshots/history.jsonl` content into records. */
export function parseHistoryJsonl(content: string): SnapshotRunRecord[] {
  const records: SnapshotRunRecord[] = []
  for (const line of content.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const row = JSON.parse(trimmed) as Partial<SnapshotRunRecord> & {
        case?: string
        name?: string
      }
      const caseName = row.caseName ?? row.case ?? row.name
      if (!caseName || typeof row.pass !== "boolean") continue
      records.push({
        caseName,
        runId: row.runId,
        pass: row.pass,
        diffRatio: typeof row.diffRatio === "number" ? row.diffRatio : 0,
        durationMs: row.durationMs,
        timestamp: row.timestamp,
        attempts: row.attempts,
      })
    } catch {
      // Skip malformed lines — history files are append-only and may be
      // truncated by a crashed run.
    }
  }
  return records
}
