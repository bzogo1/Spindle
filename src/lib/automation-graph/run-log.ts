"use client"

import { useEffect, useState } from "react"

import type { DryRunReport, DryRunStatus } from "./dry-run"
import type { AutomationGraph } from "./types"

/**
 * Local run log for automation monitoring. Every dry run recorded through the
 * builder appends an entry here (localStorage, capped); the monitoring panel
 * derives execution counts, success rates, and duration stats from it.
 */

export interface AutomationRunRecord {
  id: string
  scope: string
  graphId: string
  graphName: string
  ranAt: string
  status: DryRunStatus
  /** Wall-clock span of the simulated run (max node end offset). */
  durationMs: number
  total: number
  succeeded: number
  failed: number
  skipped: number
}

export interface AutomationRunMetrics {
  totalRuns: number
  successCount: number
  failureCount: number
  /** 0–1; 0 when no runs recorded. */
  successRate: number
  lastStatus: DryRunStatus | null
  lastRunAt: string | null
  avgDurationMs: number
  maxDurationMs: number
  /** Most recent runs, newest first (up to `limit`). */
  recent: AutomationRunRecord[]
}

const STORAGE_PREFIX = "spindle.automation-run-log.v1."
export const RUN_LOG_MAX_ENTRIES = 100
const CHANGE_EVENT = "spindle:automation-run-log-change"

export function runLogStorageKey(scope: string) {
  return `${STORAGE_PREFIX}${scope}`
}

function isRunRecord(value: unknown): value is AutomationRunRecord {
  if (typeof value !== "object" || value === null) return false
  const candidate = value as Partial<AutomationRunRecord>
  return (
    typeof candidate.id === "string" &&
    typeof candidate.scope === "string" &&
    typeof candidate.graphId === "string" &&
    typeof candidate.status === "string" &&
    typeof candidate.ranAt === "string"
  )
}

/** Recorded runs for a scope, newest first. SSR- and test-safe (returns []). */
export function readAutomationRuns(scope: string, limit?: number): AutomationRunRecord[] {
  if (typeof window === "undefined") return []
  try {
    const raw = window.localStorage.getItem(runLogStorageKey(scope))
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    const runs = Array.isArray(parsed) ? parsed.filter(isRunRecord) : []
    return typeof limit === "number" ? runs.slice(0, limit) : runs
  } catch {
    return []
  }
}

function writeAutomationRuns(scope: string, runs: AutomationRunRecord[]) {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(runLogStorageKey(scope), JSON.stringify(runs))
  } catch {
    // Storage full or unavailable — the log just won't persist.
  }
}

function notifyRunLogChange(scope: string) {
  if (typeof window === "undefined") return
  window.dispatchEvent(new CustomEvent<{ scope: string }>(CHANGE_EVENT, { detail: { scope } }))
}

function reportDurationMs(report: DryRunReport): number {
  let max = 0
  for (const result of report.results) {
    max = Math.max(max, result.startedAtMs + result.durationMs)
  }
  return max
}

/** Append a dry-run report to the scope's run log. Returns the stored record. */
export function recordAutomationRun(
  scope: string,
  graph: AutomationGraph,
  report: DryRunReport,
): AutomationRunRecord {
  const record: AutomationRunRecord = {
    id: `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    scope,
    graphId: graph.id,
    graphName: graph.name,
    ranAt: new Date().toISOString(),
    status: report.status,
    durationMs: reportDurationMs(report),
    total: report.summary.total,
    succeeded: report.summary.succeeded,
    failed: report.summary.failed,
    skipped: report.summary.skipped,
  }
  const next = [record, ...readAutomationRuns(scope)].slice(0, RUN_LOG_MAX_ENTRIES)
  writeAutomationRuns(scope, next)
  notifyRunLogChange(scope)
  return record
}

/** Remove a single run entry. */
export function deleteAutomationRun(scope: string, runId: string): void {
  const runs = readAutomationRuns(scope)
  const next = runs.filter((run) => run.id !== runId)
  if (next.length === runs.length) return
  writeAutomationRuns(scope, next)
  notifyRunLogChange(scope)
}

/** Clear the entire run log for a scope. */
export function clearAutomationRuns(scope: string): void {
  writeAutomationRuns(scope, [])
  notifyRunLogChange(scope)
}

/** Aggregate metrics over all recorded runs for a scope. */
export function automationRunMetrics(scope: string, limit = 10): AutomationRunMetrics {
  const runs = readAutomationRuns(scope)
  const totalRuns = runs.length
  const successCount = runs.filter((run) => run.status === "success").length
  const failureCount = runs.filter((run) => run.status !== "success").length
  const durations = runs.map((run) => run.durationMs)
  const newest = runs[0] ?? null
  return {
    totalRuns,
    successCount,
    failureCount,
    successRate: totalRuns === 0 ? 0 : successCount / totalRuns,
    lastStatus: newest?.status ?? null,
    lastRunAt: newest?.ranAt ?? null,
    avgDurationMs:
      totalRuns === 0 ? 0 : Math.round(durations.reduce((a, b) => a + b, 0) / totalRuns),
    maxDurationMs: durations.length ? Math.max(...durations) : 0,
    recent: runs.slice(0, limit),
  }
}

/**
 * Subscribe to a scope's run metrics. Updates live on same-tab writes and on
 * cross-tab `storage` events.
 */
export function useAutomationRunMetrics(scope: string, limit = 10): AutomationRunMetrics {
  const [metrics, setMetrics] = useState<AutomationRunMetrics>(() =>
    automationRunMetrics(scope, limit),
  )

  useEffect(() => {
    const refresh = () => setMetrics(automationRunMetrics(scope, limit))
    refresh()

    function onChange(event: Event) {
      const detail = (event as CustomEvent<{ scope?: string }>).detail
      if (detail?.scope === scope) refresh()
    }
    function onStorage(event: StorageEvent) {
      if (event.key === runLogStorageKey(scope)) refresh()
    }

    window.addEventListener(CHANGE_EVENT, onChange)
    window.addEventListener("storage", onStorage)
    return () => {
      window.removeEventListener(CHANGE_EVENT, onChange)
      window.removeEventListener("storage", onStorage)
    }
  }, [scope, limit])

  return metrics
}
