"use client"

/**
 * Performance benchmarks for the Lab screen's snapshot captures.
 *
 * Runs are simulated deterministic fixtures (`labSnapshotBenchmarkRuns` in
 * `lab-mock.ts`) — each snapshot carries a seeded history of render/capture
 * timings standing in for real profiling until a benchmark backend exists.
 * The panel shows the benchmark history (newest first), a warn/fail verdict
 * per run against its snapshot's baseline median, and a pairwise comparison
 * of any two runs across snapshots.
 */

import { useMemo, useState } from "react"
import { Gauge } from "lucide-react"

import { EmptyState } from "@/components/app/states/empty-state"
import { Select } from "@/components/ui/select"
import { formatDurationMs } from "./agent-run-log-utils"
import { formatDateTime, formatRelativeTime } from "./format"
import { labSnapshotBenchmarkRuns, type LabBenchmarkRun, type LabSnapshot } from "./lab-mock"
import {
  benchmarkRunStatus,
  benchmarkStatusBadgeClass,
  benchmarkStatusLabel,
  compareBenchmarkRuns,
  formatBenchmarkDelta,
  formatBenchmarkDeltaRatio,
  labBenchmarkBaseline,
} from "./lab-benchmarks"

interface BenchmarkEntry {
  snapshot: LabSnapshot
  run: LabBenchmarkRun
  /** Median totalMs across the snapshot's seeded runs; null when empty. */
  baselineMs: number | null
  status: ReturnType<typeof benchmarkRunStatus>
}

function runLabel(entry: BenchmarkEntry): string {
  return `${entry.snapshot.name} · run ${entry.run.runIndex}`
}

export function LabBenchmarkPanel({ snapshots }: { snapshots: LabSnapshot[] }) {
  // Flatten every snapshot's seeded runs into one history, newest first.
  const entries = useMemo<BenchmarkEntry[]>(() => {
    const flat: BenchmarkEntry[] = []
    for (const snapshot of snapshots) {
      const runs = labSnapshotBenchmarkRuns(snapshot)
      const baselineMs = labBenchmarkBaseline(runs)
      for (const run of runs) {
        flat.push({
          snapshot,
          run,
          baselineMs,
          status: benchmarkRunStatus(run, baselineMs),
        })
      }
    }
    return flat.sort((a, b) => {
      const timeDelta = new Date(b.run.createdAt).getTime() - new Date(a.run.createdAt).getTime()
      return timeDelta !== 0 ? timeDelta : a.run.id.localeCompare(b.run.id)
    })
  }, [snapshots])

  const entryByRunId = useMemo(
    () => new Map(entries.map((entry) => [entry.run.id, entry])),
    [entries],
  )

  // Compare any two runs; defaults to the two newest entries.
  const [compareAId, setCompareAId] = useState<string | null>(null)
  const [compareBId, setCompareBId] = useState<string | null>(null)
  const resolvedAId = compareAId ?? entries[0]?.run.id ?? null
  const resolvedBId = compareBId ?? entries[1]?.run.id ?? null

  const compareOptions = useMemo(
    () =>
      entries.map((entry) => ({
        value: entry.run.id,
        label: runLabel(entry),
      })),
    [entries],
  )

  const compareA = resolvedAId ? (entryByRunId.get(resolvedAId) ?? null) : null
  const compareB = resolvedBId ? (entryByRunId.get(resolvedBId) ?? null) : null
  const comparison =
    compareA && compareB && compareA.run.id !== compareB.run.id
      ? compareBenchmarkRuns(compareA.run, compareB.run)
      : null

  return (
    <section className="app-panel" aria-labelledby="lab-benchmarks-heading">
      <div className="app-panel-head">
        <div>
          <h2 id="lab-benchmarks-heading">Performance benchmarks</h2>
          <p>
            Simulated render and capture timings per snapshot — history, deltas, and warn/fail
            verdicts against each snapshot&apos;s baseline median.
          </p>
        </div>
        {entries.length > 0 ? (
          <span className="app-badge is-baseline">
            {entries.length} benchmark {entries.length === 1 ? "run" : "runs"}
          </span>
        ) : null}
      </div>

      {entries.length === 0 ? (
        <EmptyState
          icon={<Gauge aria-hidden="true" />}
          title="No benchmark data"
          body="Benchmark runs appear here once snapshots start reporting timings."
          className="border-0 bg-transparent"
        />
      ) : (
        <>
          <div className="app-lab-benchmark-compare">
            <div className="app-field">
              <label htmlFor="lab-benchmark-a">Reference run</label>
              <Select
                id="lab-benchmark-a"
                aria-label="Reference benchmark run"
                options={compareOptions}
                value={resolvedAId}
                onChange={(next) => setCompareAId(typeof next === "string" ? next : null)}
              />
            </div>
            <div className="app-field">
              <label htmlFor="lab-benchmark-b">Candidate run</label>
              <Select
                id="lab-benchmark-b"
                aria-label="Candidate benchmark run"
                options={compareOptions}
                value={resolvedBId}
                onChange={(next) => setCompareBId(typeof next === "string" ? next : null)}
              />
            </div>
            {comparison && compareA && compareB ? (
              <div className="app-lab-benchmark-result" role="status">
                <strong>
                  {runLabel(compareB)} vs {runLabel(compareA)}:{" "}
                  {comparison.faster ? "faster" : comparison.totalDeltaMs === 0 ? "even" : "slower"}
                </strong>
                <dl className="app-lab-benchmark-deltas">
                  <div>
                    <dt>Total</dt>
                    <dd>
                      {formatBenchmarkDelta(comparison.totalDeltaMs)} (
                      {formatBenchmarkDeltaRatio(comparison.totalDeltaRatio)})
                    </dd>
                  </div>
                  <div>
                    <dt>Render</dt>
                    <dd>{formatBenchmarkDelta(comparison.renderDeltaMs)}</dd>
                  </div>
                  <div>
                    <dt>Capture</dt>
                    <dd>{formatBenchmarkDelta(comparison.captureDeltaMs)}</dd>
                  </div>
                </dl>
              </div>
            ) : (
              <p className="app-field-hint app-lab-compare-hint">
                Pick two different runs to compare their timings.
              </p>
            )}
          </div>

          <ul className="app-lab-history-list">
            {entries.map((entry) => {
              const { snapshot, run, baselineMs, status } = entry
              const deltaRatio =
                baselineMs !== null && baselineMs > 0
                  ? (run.totalMs - baselineMs) / baselineMs
                  : null
              return (
                <li key={run.id} className="app-lab-history-item">
                  <span className="app-lab-history-marker" aria-hidden="true">
                    {run.runIndex}
                  </span>
                  <div className="app-lab-history-body">
                    <span className="app-lab-snapshot-title">
                      <strong>
                        {snapshot.name} — run {run.runIndex}
                      </strong>
                      <span className={`app-badge ${benchmarkStatusBadgeClass(status)}`}>
                        {benchmarkStatusLabel(status)}
                      </span>
                    </span>
                    <span className="app-lab-snapshot-meta">
                      {snapshot.environment} · {formatRelativeTime(run.createdAt)} ·{" "}
                      {formatDateTime(run.createdAt)}
                    </span>
                    <span className="app-lab-history-delta">
                      render {formatDurationMs(run.renderMs)} · capture{" "}
                      {formatDurationMs(run.captureMs)} · total {formatDurationMs(run.totalMs)}
                      {baselineMs !== null
                        ? ` · baseline ${formatDurationMs(baselineMs)} (${formatBenchmarkDeltaRatio(deltaRatio)})`
                        : ""}
                    </span>
                    <span className="app-field-hint">
                      Simulated timings for the {snapshot.environment} capture; real profiling lands
                      with the benchmark backend.
                    </span>
                  </div>
                </li>
              )
            })}
          </ul>
        </>
      )}
    </section>
  )
}
