import type { AutomationRunRecord } from "@/lib/automation-graph"

/**
 * CSV export for the builder's local run log (`run-log.ts`). Serializes every
 * recorded run for a scope — not just the recent slice shown in the panel.
 */

function csvField(value: string | number | null | undefined): string {
  const text = value === null || value === undefined ? "" : String(value)
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function automationRunRecordsToCsv(runs: readonly AutomationRunRecord[]): string {
  const header = [
    "run_id",
    "scope",
    "graph_id",
    "graph_name",
    "ran_at",
    "status",
    "duration_ms",
    "total_nodes",
    "succeeded_nodes",
    "failed_nodes",
    "skipped_nodes",
  ]
  const rows = runs.map((run) => [
    run.id,
    run.scope,
    run.graphId,
    run.graphName,
    run.ranAt,
    run.status,
    run.durationMs,
    run.total,
    run.succeeded,
    run.failed,
    run.skipped,
  ])
  return `${[header, ...rows].map((row) => row.map(csvField).join(",")).join("\n")}\n`
}

/** Trigger a browser download of `text` as a CSV file. */
export function downloadCsvFile(filename: string, csv: string) {
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
