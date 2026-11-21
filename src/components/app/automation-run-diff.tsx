"use client"

import { GitCompareArrows } from "lucide-react"

import { formatDateTime, formatDurationMs } from "./format"

/**
 * Run-to-run comparison for the automations panel. Diffs the log output of
 * the two most recent runs of an automation (LCS line diff) and exports the
 * full run log as CSV. The panel's `AutomationRun` shape satisfies
 * `DiffableRun` structurally.
 */

export type DiffableRun = {
  id: string
  label: string
  trigger: string
  startedAt: string
  duration: string
  durationMs?: number
  status: string
  logs: string[]
}

export type RunLogDiffLine = {
  kind: "same" | "added" | "removed"
  text: string
}

/**
 * Line-level diff between two runs' log output. `before` is the older run,
 * `after` the newer one; lines only in `after` are "added", lines only in
 * `before` are "removed". Uses a longest-common-subsequence DP table — run
 * logs are short, so the O(m·n) table is fine.
 */
export function diffRunLogs(before: readonly string[], after: readonly string[]): RunLogDiffLine[] {
  const m = before.length
  const n = after.length
  const lcs: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0))
  for (let i = m - 1; i >= 0; i -= 1) {
    for (let j = n - 1; j >= 0; j -= 1) {
      lcs[i][j] =
        before[i] === after[j]
          ? lcs[i + 1][j + 1] + 1
          : Math.max(lcs[i + 1][j], lcs[i][j + 1])
    }
  }

  const lines: RunLogDiffLine[] = []
  let i = 0
  let j = 0
  while (i < m && j < n) {
    if (before[i] === after[j]) {
      lines.push({ kind: "same", text: before[i] })
      i += 1
      j += 1
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      lines.push({ kind: "removed", text: before[i] })
      i += 1
    } else {
      lines.push({ kind: "added", text: after[j] })
      j += 1
    }
  }
  while (i < m) {
    lines.push({ kind: "removed", text: before[i] })
    i += 1
  }
  while (j < n) {
    lines.push({ kind: "added", text: after[j] })
    j += 1
  }
  return lines
}

function csvField(value: string | number | null | undefined): string {
  const text = value === null || value === undefined ? "" : String(value)
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/** Serialize an automation's full run history (newest first) to CSV. */
export function automationRunsToCsv(runs: readonly DiffableRun[]): string {
  const header = [
    "run_id",
    "label",
    "trigger",
    "started_at",
    "status",
    "duration",
    "duration_ms",
    "log_lines",
  ]
  const rows = runs.map((run) => [
    run.id,
    run.label,
    run.trigger,
    run.startedAt,
    run.status,
    run.duration,
    run.durationMs ?? "",
    run.logs.join(" | "),
  ])
  return `${[header, ...rows].map((row) => row.map(csvField).join(",")).join("\n")}\n`
}

function automationSlug(automationName: string): string {
  return (
    automationName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "automation"
  )
}

function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

/** Trigger a browser download of the run log CSV for `automationName`. */
export function downloadAutomationRunsCsv(automationName: string, runs: readonly DiffableRun[]) {
  downloadCsv(`${automationSlug(automationName)}-run-log.csv`, automationRunsToCsv(runs))
}

/**
 * Serialize a single run's full log output as CSV — one row per log line,
 * prefixed with the run's metadata columns so the export stays self-contained.
 */
export function automationRunLogToCsv(run: DiffableRun): string {
  const header = [
    "run_id",
    "label",
    "trigger",
    "started_at",
    "status",
    "duration",
    "duration_ms",
    "line_number",
    "log_line",
  ]
  const rows = run.logs.map((line, index) => [
    run.id,
    run.label,
    run.trigger,
    run.startedAt,
    run.status,
    run.duration,
    run.durationMs ?? "",
    index + 1,
    line,
  ])
  return `${[header, ...rows].map((row) => row.map(csvField).join(",")).join("\n")}\n`
}

/** Trigger a browser download of a single run's full log as CSV. */
export function downloadAutomationRunLogCsv(automationName: string, run: DiffableRun) {
  downloadCsv(
    `${automationSlug(automationName)}-run-log-${run.id}.csv`,
    automationRunLogToCsv(run),
  )
}

function durationDeltaLabel(previous: DiffableRun, current: DiffableRun): string | null {
  if (
    typeof previous.durationMs !== "number" ||
    typeof current.durationMs !== "number" ||
    !Number.isFinite(previous.durationMs) ||
    !Number.isFinite(current.durationMs)
  ) {
    return null
  }
  const delta = current.durationMs - previous.durationMs
  const magnitude = formatDurationMs(Math.abs(delta))
  if (delta === 0) return "same duration"
  return delta > 0 ? `+${magnitude} vs previous` : `−${magnitude} vs previous`
}

/**
 * Side-by-side-ish summary of what changed between the last two runs of an
 * automation: status, timing, and a line diff of the run logs.
 */
export function RunDiff({ previous, current }: { previous: DiffableRun; current: DiffableRun }) {
  const lines = diffRunLogs(previous.logs, current.logs)
  const added = lines.filter((line) => line.kind === "added").length
  const removed = lines.filter((line) => line.kind === "removed").length
  const delta = durationDeltaLabel(previous, current)

  return (
    <div className="mt-2 flex flex-col gap-2 rounded-md border border-border/60 p-2">
      <p className="flex items-center gap-1.5 text-[11px] font-medium">
        <GitCompareArrows className="size-3.5" aria-hidden="true" />
        Diff: {previous.label} → {current.label}
      </p>
      <dl className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-[10px]">
        <div className="flex gap-1">
          <dt>Status:</dt>
          <dd>
            {previous.status} → {current.status}
          </dd>
        </div>
        <div className="flex gap-1">
          <dt>Started:</dt>
          <dd>
            {formatDateTime(previous.startedAt)} → {formatDateTime(current.startedAt)}
          </dd>
        </div>
        {delta ? (
          <div className="flex gap-1">
            <dt>Duration:</dt>
            <dd>{delta}</dd>
          </div>
        ) : null}
        <div className="flex gap-1">
          <dt>Logs:</dt>
          <dd>
            {added} added · {removed} removed
          </dd>
        </div>
      </dl>
      {added === 0 && removed === 0 ? (
        <p className="text-muted-foreground text-[11px]">Log output is identical between runs.</p>
      ) : (
        <ol className="max-h-56 overflow-y-auto rounded border border-border/60 text-[11px]">
          {lines.map((line, index) => (
            <li
              key={`${index}-${line.kind}`}
              className={`flex gap-1.5 px-1.5 py-0.5 font-mono text-[10px] leading-snug ${
                line.kind === "added"
                  ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                  : line.kind === "removed"
                    ? "bg-red-500/10 text-red-700 dark:text-red-400"
                    : "text-muted-foreground"
              }`}
            >
              <span aria-hidden="true" className="w-3 shrink-0 select-none">
                {line.kind === "added" ? "+" : line.kind === "removed" ? "−" : " "}
              </span>
              <span className="min-w-0 break-words">{line.text}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
