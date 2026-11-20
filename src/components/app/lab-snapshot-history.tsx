"use client"

/**
 * Snapshot history for the Lab screen's Snapshots panel.
 *
 * The catalog is still mock data (`lab-mock.ts`), so "history" is derived
 * client-side: captures are grouped by environment and ordered oldest →
 * newest so each environment reads as a progression. Each entry can be
 * compared against the capture before it in the same environment, which
 * opens the shared `SnapshotComparePanel` pair.
 */

import { useMemo } from "react"
import { FlaskConical, RotateCcw } from "lucide-react"

import { EmptyState } from "@/components/app/states/empty-state"
import type { LabSnapshot, LabSnapshotApprovalStatus } from "./lab-mock"
import type { SnapshotComparisonResult } from "./lab-snapshot-compare"
import {
  formatDiffRatioPercent,
  snapshotDiffStatusBadgeClass,
  snapshotDiffStatusLabel,
} from "./lab-snapshot-thresholds"
import { formatBytes, formatDateTime } from "./format"
import { formatDurationMs } from "./agent-run-log-utils"

function snapshotTime(snapshot: LabSnapshot): number {
  const time = new Date(snapshot.createdAt).getTime()
  return Number.isNaN(time) ? 0 : time
}

function sizeDelta(previous: LabSnapshot, current: LabSnapshot): string {
  const delta = current.sizeBytes - previous.sizeBytes
  if (delta === 0) return "same size"
  const magnitude = formatBytes(Math.abs(delta))
  return delta > 0 ? `${magnitude} larger` : `${magnitude} smaller`
}

function createdDelta(previous: LabSnapshot, current: LabSnapshot): string {
  const delta = snapshotTime(current) - snapshotTime(previous)
  if (delta === 0) return "same time"
  const magnitude = formatDurationMs(Math.abs(delta))
  return delta > 0 ? `${magnitude} later` : `${magnitude} earlier`
}

function approvalBadgeClass(status: LabSnapshotApprovalStatus) {
  return `is-${status}`
}

function approvalLabel(status: LabSnapshotApprovalStatus) {
  if (status === "pending") return "Pending"
  return status === "approved" ? "Approved" : "Rejected"
}

interface SnapshotHistoryGroup {
  environment: string
  /** Captures oldest → newest so the list reads as a progression. */
  captures: LabSnapshot[]
  latestAt: number
}

/**
 * Group snapshots by environment. Groups are ordered by their most recent
 * capture (newest activity first); entries inside a group run oldest →
 * newest. First-seen environment order breaks timestamp ties.
 */
function groupSnapshotsByEnvironment(snapshots: LabSnapshot[]): SnapshotHistoryGroup[] {
  const byEnvironment = new Map<string, LabSnapshot[]>()
  for (const snapshot of snapshots) {
    const list = byEnvironment.get(snapshot.environment)
    if (list) {
      list.push(snapshot)
    } else {
      byEnvironment.set(snapshot.environment, [snapshot])
    }
  }

  const groups: SnapshotHistoryGroup[] = []
  for (const [environment, captures] of byEnvironment) {
    const sorted = [...captures].sort((a, b) => snapshotTime(a) - snapshotTime(b))
    groups.push({
      environment,
      captures: sorted,
      latestAt: snapshotTime(sorted[sorted.length - 1]),
    })
  }
  return groups.sort((a, b) => b.latestAt - a.latestAt)
}

export function SnapshotHistoryPanel({
  snapshots,
  baselineIds,
  approvalById,
  diffResults,
  restoredIds,
  onComparePair,
  onRestore,
}: {
  /** Snapshots to include — `SnapshotsPanel` passes its status-filtered list. */
  snapshots: LabSnapshot[]
  /** Ids of snapshots that are their environment's baseline reference. */
  baselineIds?: ReadonlySet<string>
  /** Review status per snapshot id; missing ids read as "pending". */
  approvalById?: Record<string, LabSnapshotApprovalStatus>
  /** Latest pixel-diff outcome per snapshot id (the "B"/actual capture). */
  diffResults?: Record<string, SnapshotComparisonResult>
  /** Snapshot ids already restored this session. */
  restoredIds?: ReadonlySet<string>
  /** Open the compare panel with `base` (earlier) vs `other` (later). */
  onComparePair: (base: LabSnapshot, other: LabSnapshot) => void
  onRestore: (snapshot: LabSnapshot) => void
}) {
  const groups = useMemo(() => groupSnapshotsByEnvironment(snapshots), [snapshots])
  const restored = restoredIds ?? new Set<string>()

  return (
    <section className="app-panel" aria-labelledby="lab-snapshot-history-heading">
      <div className="app-panel-head">
        <div>
          <h2 id="lab-snapshot-history-heading">Snapshot history</h2>
          <p>
            Captures grouped by environment, oldest first. Compare a capture with the one before it
            to see what changed.
          </p>
        </div>
      </div>
      {groups.length === 0 ? (
        <EmptyState
          icon={<FlaskConical aria-hidden="true" />}
          title="No snapshot history"
          body="Snapshots will appear here once environments start capturing state."
          className="border-0 bg-transparent"
        />
      ) : (
        <div className="app-lab-history">
          {groups.map((group) => {
            const latest = group.captures[group.captures.length - 1]
            return (
              <section
                key={group.environment}
                className="app-lab-history-group"
                aria-label={`${group.environment} snapshot history`}
              >
                <div className="app-lab-history-group-head">
                  <h3>{group.environment}</h3>
                  <span className="app-field-hint">
                    {group.captures.length} {group.captures.length === 1 ? "capture" : "captures"} ·
                    latest {formatDateTime(latest.createdAt)}
                  </span>
                </div>
                <ol className="app-lab-history-list">
                  {group.captures.map((snapshot, index) => {
                    const previous = index > 0 ? group.captures[index - 1] : null
                    const isBaseline = baselineIds?.has(snapshot.id) ?? false
                    const approvalStatus = approvalById?.[snapshot.id] ?? "pending"
                    const diffResult = diffResults?.[snapshot.id]
                    const wasRestored = restored.has(snapshot.id)
                    return (
                      <li key={snapshot.id} className="app-lab-history-item">
                        <span className="app-lab-history-marker" aria-hidden="true">
                          {index + 1}
                        </span>
                        <div className="app-lab-history-body">
                          <span className="app-lab-snapshot-title">
                            <strong>{snapshot.name}</strong>
                            {isBaseline ? (
                              <span className="app-badge is-baseline">Baseline</span>
                            ) : null}
                            <span className={`app-badge ${approvalBadgeClass(approvalStatus)}`}>
                              {approvalLabel(approvalStatus)}
                            </span>
                            {diffResult ? (
                              <span
                                className={`app-badge ${snapshotDiffStatusBadgeClass(diffResult.status)}`}
                                title={`Last pixel diff: ${formatDiffRatioPercent(diffResult.diffRatio)} changed`}
                              >
                                {snapshotDiffStatusLabel(diffResult.status)}
                              </span>
                            ) : null}
                          </span>
                          <span className="app-lab-snapshot-meta">
                            Capture {index + 1} of {group.captures.length} ·{" "}
                            {formatDateTime(snapshot.createdAt)} · {formatBytes(snapshot.sizeBytes)}
                          </span>
                          <span className="app-lab-history-delta">
                            {previous
                              ? `vs previous: ${sizeDelta(previous, snapshot)} · ${createdDelta(previous, snapshot)}`
                              : `First capture for ${group.environment}`}
                          </span>
                          <span className="app-field-hint">{snapshot.description}</span>
                        </div>
                        <div className="app-lab-snapshot-actions">
                          <button
                            type="button"
                            className="fm-btn"
                            disabled={!previous}
                            onClick={() => {
                              if (previous) onComparePair(previous, snapshot)
                            }}
                          >
                            Compare with previous
                          </button>
                          <button
                            type="button"
                            className="fm-btn"
                            disabled={wasRestored}
                            onClick={() => onRestore(snapshot)}
                          >
                            <RotateCcw aria-hidden="true" className="size-3.5" />
                            {wasRestored ? "Restored" : "Restore"}
                          </button>
                        </div>
                      </li>
                    )
                  })}
                </ol>
              </section>
            )
          })}
        </div>
      )}
    </section>
  )
}
