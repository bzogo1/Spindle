"use client"

import { useMemo } from "react"
import { BarChart3 } from "lucide-react"

import { aggregateRunAnalytics, RUN_STATUS_ORDER } from "@/lib/agent-runs/ops/analytics"
import { runDurationMs, type AgentRunRecord } from "@/lib/agent-runs/ops/types"

function formatMs(ms: number | null): string {
  if (ms === null) return "—"
  if (ms < 1000) return `${Math.round(ms)}ms`
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const rest = s % 60
  return rest > 0 ? `${m}m ${rest}s` : `${m}m`
}

function formatUsd(usd: number): string {
  if (usd === 0) return "$0.00"
  if (usd < 0.01) return `$${usd.toFixed(4)}`
  return `$${usd.toFixed(2)}`
}

/**
 * Analytics panel aggregating a set of recorded runs: counts by
 * status/model, success rate, duration percentiles, and cost totals.
 */
export function AgentRunAnalyticsPanel({
  runs,
  now,
}: {
  runs: readonly AgentRunRecord[]
  now?: number
}) {
  const summary = useMemo(() => aggregateRunAnalytics(runs, { now }), [runs, now])
  const maxStatus = useMemo(() => {
    const counts = RUN_STATUS_ORDER.map((s) => summary.byStatus[s] ?? 0)
    return Math.max(1, ...counts)
  }, [summary])
  const models = useMemo(
    () => Object.entries(summary.byModel).sort((a, b) => b[1] - a[1]),
    [summary],
  )

  return (
    <section className="app-panel" aria-labelledby="analytics-heading">
      <div className="app-panel-head">
        <div>
          <h2 id="analytics-heading">
            <BarChart3 aria-hidden="true" className="app-panel-icon" /> Run analytics
          </h2>
          <p>
            {summary.totalRuns} run{summary.totalRuns === 1 ? "" : "s"}
            {summary.latestRunAt
              ? ` · latest ${new Date(summary.latestRunAt).toLocaleString()}`
              : ""}
          </p>
        </div>
      </div>

      {summary.totalRuns === 0 ? (
        <p className="app-runlog-empty-steps">No runs to analyze yet.</p>
      ) : (
        <>
          <div className="app-analytics-cards">
            <div className="app-analytics-card">
              <span className="app-analytics-label">Success rate</span>
              <strong>
                {summary.successRate === null ? "—" : `${Math.round(summary.successRate * 100)}%`}
              </strong>
              <small>{summary.terminalRuns} terminal runs</small>
            </div>
            <div className="app-analytics-card">
              <span className="app-analytics-label">Duration p50 / p90 / p99</span>
              <strong>
                {formatMs(summary.durationMs.p50)} / {formatMs(summary.durationMs.p90)} /{" "}
                {formatMs(summary.durationMs.p99)}
              </strong>
              <small>
                avg {formatMs(summary.durationMs.avg)} · max {formatMs(summary.durationMs.max)}
              </small>
            </div>
            <div className="app-analytics-card">
              <span className="app-analytics-label">Total cost</span>
              <strong>{formatUsd(summary.totals.costUsd)}</strong>
              <small>
                {summary.totals.totalTokens.toLocaleString()} tokens · {summary.totals.withMetrics}{" "}
                runs with metrics
              </small>
            </div>
          </div>

          <div className="app-analytics-grid">
            <div>
              <h3 className="app-analytics-subhead">By status</h3>
              <ul className="app-analytics-status">
                {RUN_STATUS_ORDER.filter((s) => summary.byStatus[s]).map((status) => {
                  const count = summary.byStatus[status] ?? 0
                  return (
                    <li key={status}>
                      <span className="app-analytics-status-name">{status.replace(/_/g, " ")}</span>
                      <span className="app-analytics-bar" aria-hidden="true">
                        <span
                          className={`app-analytics-bar-fill is-${status}`}
                          style={{ width: `${(count / maxStatus) * 100}%` }}
                        />
                      </span>
                      <span className="app-analytics-status-count">{count}</span>
                    </li>
                  )
                })}
              </ul>
            </div>
            <div>
              <h3 className="app-analytics-subhead">By model</h3>
              {models.length === 0 ? (
                <p className="app-runlog-empty-steps">No model data.</p>
              ) : (
                <table className="app-analytics-table">
                  <thead>
                    <tr>
                      <th>Model</th>
                      <th>Runs</th>
                      <th>Avg duration</th>
                    </tr>
                  </thead>
                  <tbody>
                    {models.map(([model, count]) => {
                      const durations = runs
                        .filter((r) => (r.metrics.model ?? r.model ?? "unknown") === model)
                        .map((r) => runDurationMs(r, now ?? Date.now()))
                        .filter((d): d is number => d !== null)
                      const avg =
                        durations.length > 0
                          ? durations.reduce((a, b) => a + b, 0) / durations.length
                          : null
                      return (
                        <tr key={model}>
                          <td>{model}</td>
                          <td>{count}</td>
                          <td>{formatMs(avg)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </>
      )}
    </section>
  )
}
