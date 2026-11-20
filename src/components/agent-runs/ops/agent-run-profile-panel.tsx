"use client"

import { useMemo } from "react"
import { Flame } from "lucide-react"

import { buildRunProfile, detectBottlenecks, flameBarRows } from "@/lib/agent-runs/ops/profile"
import type { AgentRunRecord } from "@/lib/agent-runs/ops/types"
import { formatDurationMs } from "@/components/app/agent-run-log-utils"

const KIND_COLORS: Record<string, string> = {
  thought: "var(--color-info, #4f7cff)",
  tool_call: "var(--color-warning, #d97706)",
  result: "var(--color-success, #16a34a)",
}

/**
 * Profiling panel: per-step timing breakdown rendered as a hand-rolled flame
 * bar (positioned divs), plus detected bottlenecks.
 */
export function AgentRunProfilePanel({ run, now }: { run: AgentRunRecord; now?: number }) {
  const profile = useMemo(() => buildRunProfile(run, { now }), [run, now])
  const rows = useMemo(() => flameBarRows(profile), [profile])
  const bottlenecks = useMemo(() => detectBottlenecks(profile), [profile])

  return (
    <section className="app-panel" aria-labelledby="profile-heading">
      <div className="app-panel-head">
        <div>
          <h2 id="profile-heading">
            <Flame aria-hidden="true" className="app-panel-icon" /> Profile
          </h2>
          <p>
            {profile.steps.length} profiled step{profile.steps.length === 1 ? "" : "s"} over{" "}
            {formatDurationMs(profile.totalMs)}
            {profile.skippedSteps > 0 ? ` · ${profile.skippedSteps} skipped (bad timestamps)` : ""}
          </p>
        </div>
      </div>

      {profile.steps.length === 0 ? (
        <p className="app-runlog-empty-steps">No timed steps to profile.</p>
      ) : (
        <>
          <div className="app-flame" role="img" aria-label="Step timing flame bar">
            <div className="app-flame-track">
              {rows.map(({ step, leftPct, widthPct }) => (
                <div
                  key={step.stepId}
                  className={`app-flame-bar is-${step.kind}`}
                  style={{
                    left: `${leftPct}%`,
                    width: `${widthPct}%`,
                    backgroundColor: KIND_COLORS[step.kind],
                  }}
                  title={`${step.title} — ${formatDurationMs(step.durationMs)}`}
                />
              ))}
            </div>
            <div className="app-flame-axis">
              <span>0s</span>
              <span>{formatDurationMs(profile.totalMs / 2)}</span>
              <span>{formatDurationMs(profile.totalMs)}</span>
            </div>
          </div>

          <table className="app-analytics-table">
            <thead>
              <tr>
                <th>Step</th>
                <th>Kind</th>
                <th>Start</th>
                <th>Duration</th>
                <th>Share</th>
              </tr>
            </thead>
            <tbody>
              {profile.steps.map((step) => (
                <tr key={step.stepId}>
                  <td>{step.title}</td>
                  <td>{step.kind.replace(/_/g, " ")}</td>
                  <td>{formatDurationMs(step.startOffsetMs)}</td>
                  <td>{formatDurationMs(step.durationMs)}</td>
                  <td>{step.share === null ? "—" : `${Math.round(step.share * 100)}%`}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {bottlenecks.length > 0 ? (
            <div className="app-profile-bottlenecks">
              <h3 className="app-analytics-subhead">Bottlenecks</h3>
              <ul>
                {bottlenecks.map((b) => (
                  <li key={b.step.stepId}>
                    <strong>{b.step.title}</strong> — {formatDurationMs(b.durationMs)} (
                    {Math.round(b.share * 100)}% of run). {b.reason}.
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="app-runlog-empty-steps">No single step dominates this run.</p>
          )}
        </>
      )}
    </section>
  )
}
