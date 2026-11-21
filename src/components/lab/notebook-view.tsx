"use client"

/**
 * Interactive notebook view for the Lab screen's JupyterLab environment.
 *
 * The backend has no kernel API yet, so everything is simulated client-side:
 * cells come from `LAB_NOTEBOOK_CELLS` (pre-executed mock output), Run buttons
 * fake execution with a timer, and Interrupt/Restart drive a mock kernel
 * status that the console pane logs. The layout is a resizable split —
 * notebook cells on the left, kernel console on the right — with a drag
 * handle (pointer + keyboard accessible). "Notebook history" lists the
 * seeded `LAB_NOTEBOOK_HISTORY` revisions with a mock restore. The toolbar
 * also carries a kernel CPU/memory status badge (jittered mock readings), a
 * "Share notebook" button that copies a link encoding the session's cell
 * runs and row filter (`?nbexec=`/`?nbfilter=`), a "Cells executed" counter,
 * and a "Download" button that serializes the cells to `.ipynb` (nbformat 4)
 * via `labNotebookToIpynb`. Each code cell has an Output toggle and `table`
 * outputs render as a sortable `NotebookDataTable` with a live row count, a
 * "Filter rows" input, and a per-table CSV export; re-running a table cell
 * appends deterministic rows so the count reflects current data. The toolbar
 * also carries an "Export table" button that downloads the active cell's
 * table output as CSV (Blob download) honoring the row filter.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useSearchParams } from "next/navigation"
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronsDownUp,
  ChevronsUpDown,
  Download,
  Eye,
  EyeOff,
  FileDown,
  History,
  MessageSquarePlus,
  Moon,
  Play,
  RotateCcw,
  Square,
  Sun,
  Table,
} from "lucide-react"

import { useToast } from "@/components/ui/toast"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { CopyButton } from "@/components/app/copy-button"
import { formatBytes, formatDateTime, formatRelativeTime } from "@/components/app/format"
import { useAppTheme } from "@/components/app/use-app-theme"
import {
  downloadNotebookExport,
  highlightNotebookCode,
  notebookCellMatches,
  NOTEBOOK_EXPORT_FORMATS,
  type NotebookComment,
  type NotebookExportFormat,
  type NotebookTheme,
} from "@/components/app/lab-notebook"
import {
  labNotebookShareHref,
  parseLabNotebookShareParams,
  type LabNotebookShareState,
} from "@/components/app/lab-notebook-share"
import {
  reportLabCellExecutionStats,
  resetLabCellExecutionStats,
} from "@/components/app/lab-cell-executions"
import {
  LAB_NOTEBOOK_CURRENT_REVISION,
  LAB_NOTEBOOK_DEFAULT_TEMPLATE_ID,
  LAB_NOTEBOOK_HISTORY,
  LAB_NOTEBOOK_TEMPLATES,
  labNotebookAppendedRows,
  labNotebookToIpynb,
  type LabNotebookCell,
  type LabNotebookTable,
  type LabNotebookTemplate,
} from "@/components/app/lab-mock"

type KernelStatus = "idle" | "busy" | "restarting"

/** Per-cell execution override; cells without an entry show their static output. */
type CellRunState = "running" | "interrupted"

const SPLIT_MIN_PCT = 25
const SPLIT_MAX_PCT = 75
const SPLIT_KEY_STEP = 5

/** Simulated execution time for a single cell run. */
const CELL_RUN_MS = 1600
/** Simulated kernel restart time. */
const KERNEL_RESTART_MS = 900
/** How often the mock kernel CPU/memory readings jitter. */
const KERNEL_METRICS_TICK_MS = 2000

function kernelStatusLabel(status: KernelStatus) {
  if (status === "busy") return "Kernel busy"
  if (status === "restarting") return "Kernel restarting"
  return "Kernel idle"
}

function kernelBadgeClass(status: KernelStatus) {
  if (status === "busy") return "is-running"
  if (status === "restarting") return "is-starting"
  return "is-succeeded"
}

function defaultNotebookTemplate(): LabNotebookTemplate {
  return (
    LAB_NOTEBOOK_TEMPLATES.find(
      (candidate) => candidate.id === LAB_NOTEBOOK_DEFAULT_TEMPLATE_ID,
    ) ?? LAB_NOTEBOOK_TEMPLATES[0]
  )
}

/** Shallow-copy template cells so run/export state never mutates the mock catalog. */
function cloneNotebookCells(cells: LabNotebookCell[]): LabNotebookCell[] {
  return cells.map((cell) => ({
    ...cell,
    outputs: cell.outputs.map((output) => ({
      ...output,
      table: output.table
        ? {
            ...output.table,
            columns: [...output.table.columns],
            rows: output.table.rows.map((row) => ({ ...row })),
          }
        : undefined,
    })),
  }))
}

/* -------------------------------------------------------------------------- */
/* Sortable cell-output table                                                  */
/* -------------------------------------------------------------------------- */

function csvCell(value: string | number) {
  return `"${String(value).replaceAll('"', '""')}"`
}

/** Table output as CSV: one header row (column keys) plus one row per record. */
function notebookTableCsv(
  table: LabNotebookTable,
  rows: Record<string, string | number>[],
): string {
  const lines = [
    table.columns.map((column) => column.key).join(","),
    ...rows.map((row) =>
      table.columns.map((column) => csvCell(row[column.key] ?? "")).join(","),
    ),
  ]
  return lines.join("\n")
}

function downloadNotebookCsv(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

/** Case-insensitive substring match across every column value of a row. */
function notebookRowMatches(
  row: Record<string, string | number>,
  columns: LabNotebookTable["columns"],
  term: string,
) {
  return columns.some((column) =>
    String(row[column.key] ?? "")
      .toLowerCase()
      .includes(term),
  )
}

/**
 * Interactive table rendered for `kind === "table"` cell outputs — the mock
 * stand-in for a DataFrame preview. Column headers toggle asc/desc sorting
 * (same click-to-cycle pattern as the files screen's `fm-sort` headers).
 * `extraRows` are the deterministic batches appended by re-running the cell,
 * `filter` is the notebook-wide "Filter rows" term, and the footer count plus
 * the CSV export always reflect the currently visible rows. Each table also
 * has its own "Filter rows" input that narrows rows by column value on top of
 * the notebook-wide term.
 */
function NotebookDataTable({
  table,
  extraRows,
  filter,
  exportName,
}: {
  table: LabNotebookTable
  extraRows: Record<string, string | number>[]
  filter: string
  exportName: string
}) {
  const [sort, setSort] = useState<{ key: string; direction: "asc" | "desc" } | null>(null)
  // Per-table "Filter rows" term; matches against any column value.
  const [rowFilter, setRowFilter] = useState("")

  const allRows = useMemo(() => [...table.rows, ...extraRows], [table.rows, extraRows])

  const term = filter.trim().toLowerCase()
  const localTerm = rowFilter.trim().toLowerCase()
  const filteredRows = useMemo(
    () =>
      allRows.filter(
        (row) =>
          (!term || notebookRowMatches(row, table.columns, term)) &&
          (!localTerm || notebookRowMatches(row, table.columns, localTerm)),
      ),
    [allRows, table.columns, term, localTerm],
  )

  const sortedRows = useMemo(() => {
    if (!sort) return filteredRows
    const direction = sort.direction === "asc" ? 1 : -1
    return [...filteredRows].sort((a, b) => {
      const left = a[sort.key]
      const right = b[sort.key]
      if (typeof left === "number" && typeof right === "number") {
        return (left - right) * direction
      }
      return String(left ?? "").localeCompare(String(right ?? "")) * direction
    })
  }, [filteredRows, sort])

  const toggleSort = (key: string) => {
    setSort((current) => {
      if (current?.key !== key) return { key, direction: "asc" }
      return current.direction === "asc" ? { key, direction: "desc" } : null
    })
  }

  const handleExport = () => {
    downloadNotebookCsv(exportName, notebookTableCsv(table, sortedRows))
  }

  return (
    <div>
      <div className="mb-1">
        <Input
          type="search"
          value={rowFilter}
          onChange={(event) => setRowFilter(event.target.value)}
          placeholder="Filter rows…"
          aria-label={`Filter rows in ${exportName.replace(/\.csv$/, "")}`}
          className="h-7 w-44 text-xs"
        />
      </div>
      <div className="overflow-x-auto rounded-lg border border-[var(--app-border)]">
        <table className="w-full border-collapse text-left text-xs">
          <thead>
            <tr className="border-b border-[var(--app-border)]">
              {table.columns.map((column) => {
                const active = sort?.key === column.key
                const Icon = active
                  ? sort.direction === "asc"
                    ? ArrowUp
                    : ArrowDown
                  : ArrowUpDown
                return (
                  <th
                    key={column.key}
                    className="px-3 py-2 font-semibold"
                    aria-sort={
                      active ? (sort.direction === "asc" ? "ascending" : "descending") : "none"
                    }
                  >
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 hover:text-[var(--app-accent)]"
                      onClick={() => toggleSort(column.key)}
                    >
                      {column.label}
                      <Icon className="size-3" aria-hidden="true" />
                    </button>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((row, index) => (
              <tr
                key={index}
                className="border-b border-[var(--app-border)] last:border-0"
              >
                {table.columns.map((column) => (
                  <td key={column.key} className="px-3 py-1.5">
                    {String(row[column.key] ?? "")}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-1 flex items-center justify-between gap-2">
        <p className="app-field-hint">
          {term || localTerm
            ? `Showing ${sortedRows.length} of ${allRows.length} rows`
            : `${allRows.length} ${allRows.length === 1 ? "row" : "rows"}`}
        </p>
        <button
          type="button"
          className="fm-btn"
          disabled={sortedRows.length === 0}
          onClick={handleExport}
          aria-label={`Export ${exportName} as CSV`}
        >
          <Download aria-hidden="true" className="size-3.5" />
          Export CSV
        </button>
      </div>
    </div>
  )
}

function NotebookCellView({
  cell,
  runState,
  collapsed,
  outputsHidden,
  appendedRows,
  filter,
  exportPrefix,
  onRun,
  onToggleOutputs,
  runDisabled,
  theme,
  isActive,
  onActivate,
  comments,
  commentOpen,
  commentDraft,
  onCommentDraftChange,
  onComment,
  onSaveComment,
  onCancelComment,
}: {
  cell: LabNotebookCell
  runState: CellRunState | undefined
  collapsed: boolean
  outputsHidden: boolean
  /** Deterministic rows appended by this session's re-runs, keyed by output id. */
  appendedRows: Record<string, Record<string, string | number>[]>
  /** Notebook-wide "Filter rows" term applied to every table output. */
  filter: string
  /** Filename prefix for per-table CSV exports (without extension). */
  exportPrefix: string
  onRun: () => void
  onToggleOutputs: () => void
  runDisabled: boolean
  /** Notebook code-highlight palette; follows the app theme unless overridden. */
  theme: NotebookTheme
  isActive: boolean
  onActivate: () => void
  comments: NotebookComment[]
  commentOpen: boolean
  commentDraft: string
  onCommentDraftChange: (value: string) => void
  onComment: () => void
  onSaveComment: () => void
  onCancelComment: () => void
}) {
  const isCode = cell.kind === "code"
  const firstLine = cell.source.split("\n")[0] ?? ""
  const hasOutputs = cell.outputs.length > 0

  return (
    <div
      className={`rounded-xl border bg-[var(--app-bg)] ${
        isActive ? "border-[var(--app-accent)]" : "border-[var(--app-border)]"
      }`}
      onClick={onActivate}
    >
      <div className="flex items-center gap-2 border-b border-[var(--app-border)] px-3 py-1.5">
        <span className="app-cell-badge">
          {cell.executionCount === null ? "Markdown" : `In [${cell.executionCount}]`}
        </span>
        <span className="ml-auto flex items-center gap-2">
          {isCode && hasOutputs ? (
            <button
              type="button"
              className="fm-btn"
              aria-pressed={!outputsHidden}
              onClick={onToggleOutputs}
            >
              Output
            </button>
          ) : null}
          {isCode ? (
            <button
              type="button"
              className="fm-btn"
              disabled={runDisabled}
              onClick={onRun}
              aria-label={`Run cell ${cell.executionCount ?? cell.id}`}
            >
              <Play aria-hidden="true" className="size-3.5" />
              Run
            </button>
          ) : null}
          <button
            type="button"
            className="fm-btn"
            aria-pressed={commentOpen}
            onClick={onComment}
            aria-label={`Comment on cell ${cell.executionCount ?? cell.id}`}
          >
            <MessageSquarePlus aria-hidden="true" className="size-3.5" />
            Comment{comments.length > 0 ? ` (${comments.length})` : ""}
          </button>
        </span>
      </div>

      {collapsed ? (
        <p className="truncate px-3 py-2 text-xs text-[var(--app-text-muted)]">{firstLine}</p>
      ) : (
        <div className="px-3 py-2">
          {isCode ? (
            <pre className="app-lab-code whitespace-pre-wrap">
              <code dangerouslySetInnerHTML={{ __html: highlightNotebookCode(cell.source, theme) }} />
            </pre>
          ) : (
            <p className="text-sm whitespace-pre-wrap text-[var(--app-text)]">{cell.source}</p>
          )}

          {isCode && !outputsHidden ? (
            <div className="mt-2 space-y-1.5">
              {runState === "running" ? (
                <div className="app-notebook-cell">
                  <span className="app-cell-badge">Out[…]</span>
                  <code>Running…</code>
                </div>
              ) : runState === "interrupted" ? (
                <div className="app-notebook-cell">
                  <span className="app-cell-badge">Error</span>
                  <code>KeyboardInterrupt: Execution interrupted.</code>
                </div>
              ) : (
                cell.outputs.map((output) =>
                  output.kind === "table" && output.table ? (
                    <div key={output.id} className="app-notebook-cell">
                      <span className="app-cell-badge">Out</span>
                      <div className="min-w-0 flex-1">
                        <NotebookDataTable
                          table={output.table}
                          extraRows={appendedRows[output.id] ?? []}
                          filter={filter}
                          exportName={`${exportPrefix}-${output.id}.csv`}
                        />
                      </div>
                    </div>
                  ) : (
                    <div
                      key={output.id}
                      className={`app-notebook-cell${output.kind === "error" ? "is-error" : ""}`}
                    >
                      <span className="app-cell-badge">
                        {output.kind === "error" ? "Error" : "Out"}
                      </span>
                      <code>{output.content}</code>
                    </div>
                  ),
                )
              )}
            </div>
          ) : null}
        </div>
      )}

      {comments.length > 0 || commentOpen ? (
        <div className="space-y-1.5 border-t border-[var(--app-border)] px-3 py-2">
          {comments.map((comment) => (
            <p key={comment.id} className="app-field-hint m-0">
              <strong>{comment.author}</strong> — {comment.text}{" "}
              <span>· {formatRelativeTime(comment.createdAt)}</span>
            </p>
          ))}
          {commentOpen ? (
            <div className="grid gap-2">
              <Textarea
                aria-label={`Comment on cell ${cell.executionCount ?? cell.id}`}
                placeholder="Add a comment…"
                value={commentDraft}
                onChange={(event) => onCommentDraftChange(event.target.value)}
                rows={2}
                autoResize
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  className="fm-btn fm-btn--solid"
                  disabled={!commentDraft.trim()}
                  onClick={onSaveComment}
                >
                  Add comment
                </button>
                <button type="button" className="fm-btn" onClick={onCancelComment}>
                  Cancel
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

export function NotebookView() {
  const { toast } = useToast()
  // Shareable links (`?notebook=`/`?nbexec=`/`?nbfilter=`) seed the session's
  // cell runs and row filter; `useSearchParams` suspends to the route's
  // Suspense boundary during prerender, same as the lab snapshots panel.
  const searchParams = useSearchParams()
  const shareQuery = searchParams.toString()
  const share = useMemo(
    () => parseLabNotebookShareParams(new URLSearchParams(shareQuery)),
    [shareQuery],
  )

  const [kernelStatus, setKernelStatus] = useState<KernelStatus>("idle")
  // Mock kernel resource readings, jittered on an interval; a busy kernel
  // gets a CPU boost on top so executing a cell visibly loads the kernel.
  const [kernelMetrics, setKernelMetrics] = useState({ cpu: 6, memoryMb: 620 })
  const [cellRuns, setCellRuns] = useState<Record<string, CellRunState>>({})
  // Completed runs per cell this session (or restored from a share link) —
  // drives the "Cells executed" counter and the appended table rows.
  const [runCounts, setRunCounts] = useState<Record<string, number>>(() => ({
    ...(share.cells ?? {}),
  }))
  // Notebook-wide "Filter rows" term, seeded from `?nbfilter=`.
  const [filter, setFilter] = useState(() => share.filter ?? "")
  // Cell ids whose output area is toggled off (task: show/hide cell output).
  const [hiddenOutputs, setHiddenOutputs] = useState<Set<string>>(new Set())
  const [cellsCollapsed, setCellsCollapsed] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [activeRevisionId, setActiveRevisionId] = useState(LAB_NOTEBOOK_CURRENT_REVISION)
  const [consoleLines, setConsoleLines] = useState<string[]>([
    "Kernel started: Python 3.12 · ipykernel 6.29",
  ])

  /* ---- Notebook template / theme / search / comments (all mock) ---- */

  const appTheme = useAppTheme()
  // `?notebook=` seeds the template; anything unrecognized falls back to the
  // default below via the `?? defaultNotebookTemplate()` lookup.
  const [templateId, setTemplateId] = useState(
    () => share.notebook ?? LAB_NOTEBOOK_DEFAULT_TEMPLATE_ID,
  )
  const template =
    LAB_NOTEBOOK_TEMPLATES.find((candidate) => candidate.id === templateId) ??
    defaultNotebookTemplate()
  const [cells, setCells] = useState<LabNotebookCell[]>(() =>
    cloneNotebookCells(template.cells),
  )
  const [searchQuery, setSearchQuery] = useState("")
  const [exportFormat, setExportFormat] = useState<NotebookExportFormat>("markdown")
  // `null` follows the app theme; the toggle pins a notebook-specific variant
  // so code colors can differ from the surrounding chrome.
  const [themeOverride, setThemeOverride] = useState<NotebookTheme | null>(null)
  const notebookTheme: NotebookTheme = themeOverride ?? (appTheme.dark ? "dark" : "light")
  const [activeCellId, setActiveCellId] = useState<string | null>(cells[0]?.id ?? null)
  const [commentsByCell, setCommentsByCell] = useState<Record<string, NotebookComment[]>>({})
  const [openCommentCellId, setOpenCommentCellId] = useState<string | null>(null)
  const [commentDraft, setCommentDraft] = useState("")

  const searchTerm = searchQuery.trim().toLowerCase()
  const visibleCells = useMemo(
    () =>
      searchTerm
        ? cells.filter((cell) => {
            const comments = commentsByCell[cell.id] ?? []
            return (
              notebookCellMatches(cell, searchTerm) ||
              comments.some((comment) => comment.text.toLowerCase().includes(searchTerm))
            )
          })
        : cells,
    [cells, commentsByCell, searchTerm],
  )

  /* ---- Resizable split pane ---- */

  const splitRef = useRef<HTMLDivElement>(null)
  const [splitPct, setSplitPct] = useState(60)
  const draggingRef = useRef(false)

  const updateSplitFromClientX = useCallback((clientX: number) => {
    const container = splitRef.current
    if (!container) return
    const rect = container.getBoundingClientRect()
    if (rect.width <= 0) return
    const pct = ((clientX - rect.left) / rect.width) * 100
    setSplitPct(Math.min(SPLIT_MAX_PCT, Math.max(SPLIT_MIN_PCT, pct)))
  }, [])

  const handleSplitKeyDown = useCallback((event: React.KeyboardEvent) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return
    event.preventDefault()
    setSplitPct((previous) =>
      Math.min(
        SPLIT_MAX_PCT,
        Math.max(
          SPLIT_MIN_PCT,
          previous + (event.key === "ArrowRight" ? SPLIT_KEY_STEP : -SPLIT_KEY_STEP),
        ),
      ),
    )
  }, [])

  /* ---- Kernel simulation ---- */

  const timers = useRef<number[]>([])
  useEffect(() => {
    return () => {
      for (const timer of timers.current) window.clearTimeout(timer)
    }
  }, [])

  /* ---- Mock kernel metrics heartbeat ---- */

  useEffect(() => {
    const timer = window.setInterval(() => {
      setKernelMetrics((previous) => ({
        cpu: Math.min(
          42,
          Math.max(2, Math.round(previous.cpu + (Math.random() * 10 - 5))),
        ),
        memoryMb: Math.min(
          1600,
          Math.max(380, Math.round(previous.memoryMb + (Math.random() * 90 - 45))),
        ),
      }))
    }, KERNEL_METRICS_TICK_MS)
    return () => window.clearInterval(timer)
  }, [])

  /* ---- Share params ---- */

  // Re-apply share params when the query changes (client-side navigation);
  // the mount-time seed is the `useState` initializer above. Guarded so local
  // edits don't get clobbered by unrelated query churn.
  const appliedShareQuery = useRef(shareQuery)
  useEffect(() => {
    if (appliedShareQuery.current === shareQuery) return
    appliedShareQuery.current = shareQuery
    // Only notebook share params re-seed state — unrelated query churn (e.g.
    // snapshot `?compare=` links on the same page) must not wipe local runs.
    if (share.notebook === undefined && share.cells === undefined && share.filter === undefined) {
      return
    }
    const nextTemplateId = share.notebook ?? LAB_NOTEBOOK_DEFAULT_TEMPLATE_ID
    const nextTemplate =
      LAB_NOTEBOOK_TEMPLATES.find((candidate) => candidate.id === nextTemplateId) ??
      defaultNotebookTemplate()
    setTemplateId(nextTemplate.id)
    setCells(cloneNotebookCells(nextTemplate.cells))
    setRunCounts({ ...(share.cells ?? {}) })
    setFilter(share.filter ?? "")
  }, [shareQuery, share])

  /* ---- Live table data ---- */

  // Each completed run of a table-output cell appends one deterministic batch
  // (`labNotebookAppendedRows`), so the row count reflects current data and a
  // shared `?nbexec=` link reproduces the same table.
  const appendedRows = useMemo(() => {
    const map: Record<string, Record<string, string | number>[]> = {}
    for (const cell of cells) {
      const runs = runCounts[cell.id] ?? 0
      if (runs === 0) continue
      for (const output of cell.outputs) {
        if (output.kind !== "table" || !output.table) continue
        const batches: Record<string, string | number>[] = []
        for (let batch = 0; batch < runs; batch += 1) {
          batches.push(...labNotebookAppendedRows(output.table, batch))
        }
        map[output.id] = batches
      }
    }
    return map
  }, [cells, runCounts])

  const codeCells = cells.filter((cell) => cell.kind === "code")
  const cellsRun = codeCells.filter((cell) => (runCounts[cell.id] ?? 0) > 0).length
  const totalRuns = codeCells.reduce((sum, cell) => sum + (runCounts[cell.id] ?? 0), 0)

  /* ---- Show/hide all cell outputs ---- */

  const cellsWithOutputs = cells.filter(
    (cell) => cell.kind === "code" && cell.outputs.length > 0,
  )
  const allOutputsHidden =
    cellsWithOutputs.length > 0 &&
    cellsWithOutputs.every((cell) => hiddenOutputs.has(cell.id))

  const toggleAllCellOutputs = useCallback(() => {
    setHiddenOutputs((previous) => {
      const withOutputs = cells.filter(
        (cell) => cell.kind === "code" && cell.outputs.length > 0,
      )
      const allHidden =
        withOutputs.length > 0 && withOutputs.every((cell) => previous.has(cell.id))
      if (allHidden) return new Set()
      return new Set(withOutputs.map((cell) => cell.id))
    })
  }, [cells])

  /* ---- Lab panel cell-execution counter ---- */

  // Publish this session's stats so the lab panel header can show the same
  // "Cells executed" count; cleared when the notebook view unmounts.
  useEffect(() => {
    reportLabCellExecutionStats({
      cellsExecuted: cellsRun,
      codeCells: codeCells.length,
      totalRuns,
    })
  }, [cellsRun, codeCells.length, totalRuns])

  useEffect(() => resetLabCellExecutionStats, [])

  const shareState: LabNotebookShareState = {
    notebook: templateId,
    cells: Object.fromEntries(Object.entries(runCounts).filter(([, count]) => count > 0)),
    filter,
  }

  const kernelCpu = Math.min(
    99,
    Math.max(0, Math.round(kernelMetrics.cpu + (kernelStatus === "busy" ? 15 : 0))),
  )
  const kernelMemoryLabel = formatBytes(kernelMetrics.memoryMb * 1024 * 1024)

  const toggleCellOutputs = useCallback((cellId: string) => {
    setHiddenOutputs((previous) => {
      const next = new Set(previous)
      if (next.has(cellId)) next.delete(cellId)
      else next.add(cellId)
      return next
    })
  }, [])

  const appendConsole = useCallback((line: string) => {
    setConsoleLines((previous) => [...previous.slice(-49), line])
  }, [])

  /* ---- Download notebook as .ipynb ---- */

  const handleDownload = useCallback(() => {
    const fileName = template.fileName
    const notebook = labNotebookToIpynb(cells)
    const blob = new Blob([`${JSON.stringify(notebook, null, 1)}\n`], {
      type: "application/x-ipynb+json",
    })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = fileName
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
    appendConsole(`Downloaded ${fileName}`)
  }, [appendConsole, cells, template.fileName])

  /* ---- Notebook template / export / theme / comments ---- */

  const handleTemplateChange = useCallback(
    (next: string | string[] | null) => {
      const id = typeof next === "string" ? next : null
      const nextTemplate = LAB_NOTEBOOK_TEMPLATES.find((candidate) => candidate.id === id)
      if (!nextTemplate) return
      setTemplateId(nextTemplate.id)
      setCells(cloneNotebookCells(nextTemplate.cells))
      setCellRuns({})
      setRunCounts({})
      setHiddenOutputs(new Set())
      setCommentsByCell({})
      setOpenCommentCellId(null)
      setCommentDraft("")
      setSearchQuery("")
      setActiveCellId(nextTemplate.cells[0]?.id ?? null)
      appendConsole(`Loaded notebook template ${nextTemplate.name}`)
      toast({
        variant: "success",
        title: "Notebook template loaded",
        description: `${nextTemplate.name} loaded into the notebook (mock).`,
      })
    },
    [appendConsole, toast],
  )

  const handleExport = useCallback(() => {
    downloadNotebookExport(exportFormat, cells, template.fileName, {
      title: template.name,
      theme: notebookTheme,
    })
    appendConsole(`Exported ${template.name} as ${exportFormat.toUpperCase()}`)
    toast({
      variant: "success",
      title: "Notebook exported",
      description: `${template.name} exported as ${exportFormat.toUpperCase()} (mock).`,
    })
  }, [appendConsole, cells, exportFormat, notebookTheme, template, toast])

  const toggleNotebookTheme = useCallback(() => {
    const next: NotebookTheme = notebookTheme === "dark" ? "light" : "dark"
    // Toggling back to the app theme clears the override so the notebook
    // follows the shell again.
    setThemeOverride(next === (appTheme.dark ? "dark" : "light") ? null : next)
    toast({
      variant: "info",
      title: `Notebook theme: ${next === "dark" ? "Dark" : "Light"}`,
      description: "Syntax highlighting colors updated.",
    })
  }, [appTheme.dark, notebookTheme, toast])

  const openCellComment = useCallback((cellId: string) => {
    setActiveCellId(cellId)
    setOpenCommentCellId(cellId)
    setCommentDraft("")
  }, [])

  const saveCellComment = useCallback(
    (cellId: string) => {
      const text = commentDraft.trim()
      if (!text) return
      const comment: NotebookComment = {
        id: `comment-${Date.now()}-${cellId}`,
        cellId,
        author: "you",
        text,
        createdAt: new Date().toISOString(),
      }
      setCommentsByCell((previous) => ({
        ...previous,
        [cellId]: [...(previous[cellId] ?? []), comment],
      }))
      setCommentDraft("")
      setOpenCommentCellId(null)
      appendConsole(`Comment added to cell ${cellId}`)
      toast({
        variant: "success",
        title: "Comment added",
        description: "Notebook comments are stored locally (mock).",
      })
    },
    [appendConsole, commentDraft, toast],
  )

  const commentTargetId =
    activeCellId && cells.some((cell) => cell.id === activeCellId)
      ? activeCellId
      : (visibleCells[0]?.id ?? cells[0]?.id ?? null)

  /* ---- Export the active cell's table output as CSV ---- */

  // "Current table" = the first `table` output of the active cell. Rows are
  // the seeded rows plus this session's appended batches, filtered by the
  // notebook-wide "Filter rows" term (same scope as the per-table export,
  // minus that table's local sort state).
  const activeTableOutput = useMemo(() => {
    const cell = cells.find((candidate) => candidate.id === commentTargetId)
    return (
      cell?.outputs.find((output) => output.kind === "table" && output.table) ?? null
    )
  }, [cells, commentTargetId])

  const handleExportTable = useCallback(() => {
    const table = activeTableOutput?.table
    if (!activeTableOutput || !table) return
    const allRows = [...table.rows, ...(appendedRows[activeTableOutput.id] ?? [])]
    const term = filter.trim().toLowerCase()
    const rows = term
      ? allRows.filter((row) => notebookRowMatches(row, table.columns, term))
      : allRows
    if (rows.length === 0) return
    const fileName = `${template.id}-${activeTableOutput.id}.csv`
    downloadNotebookCsv(fileName, notebookTableCsv(table, rows))
    appendConsole(`Exported ${fileName}`)
    toast({
      variant: "success",
      title: "Table exported",
      description: `${rows.length} ${rows.length === 1 ? "row" : "rows"} downloaded as CSV.`,
    })
  }, [activeTableOutput, appendedRows, appendConsole, filter, template.id, toast])

  const handleRunCell = useCallback(
    (cell: LabNotebookCell) => {
      if (kernelStatus !== "idle") return
      setKernelStatus("busy")
      setCellRuns((previous) => ({ ...previous, [cell.id]: "running" }))
      appendConsole(`Executing cell ${cell.executionCount ?? cell.id}…`)

      timers.current.push(
        window.setTimeout(() => {
          setCellRuns((previous) => {
            const next = { ...previous }
            delete next[cell.id]
            return next
          })
          setRunCounts((previous) => ({
            ...previous,
            [cell.id]: (previous[cell.id] ?? 0) + 1,
          }))
          setKernelStatus("idle")
          appendConsole(`Cell ${cell.executionCount ?? cell.id} finished.`)
        }, CELL_RUN_MS),
      )
    },
    [appendConsole, kernelStatus],
  )

  const handleInterrupt = useCallback(() => {
    if (kernelStatus !== "busy") return
    setKernelStatus("idle")
    setCellRuns((previous) => {
      const runningId = Object.keys(previous).find((id) => previous[id] === "running")
      return runningId ? { ...previous, [runningId]: "interrupted" } : previous
    })
    appendConsole("KeyboardInterrupt: execution interrupted by user.")
    toast({
      variant: "warning",
      title: "Kernel interrupted",
      description: "The running cell was stopped (mock).",
    })
  }, [appendConsole, kernelStatus, toast])

  const handleRestart = useCallback(() => {
    if (kernelStatus === "restarting") return
    setKernelStatus("restarting")
    setCellRuns({})
    appendConsole("Restarting kernel…")

    timers.current.push(
      window.setTimeout(() => {
        setKernelStatus("idle")
        appendConsole("Kernel restarted: Python 3.12 · ipykernel 6.29")
        toast({
          variant: "success",
          title: "Kernel restarted",
          description: "The notebook kernel session was restarted (mock).",
        })
      }, KERNEL_RESTART_MS),
    )
  }, [appendConsole, kernelStatus, toast])

  const handleRestoreRevision = useCallback(
    (revisionId: string) => {
      setActiveRevisionId(revisionId)
      const revision = LAB_NOTEBOOK_HISTORY.find((candidate) => candidate.id === revisionId)
      toast({
        variant: "success",
        title: `Notebook restored to ${revision?.label ?? revisionId}`,
        description: revision ? `${revision.summary} (mock)` : "(mock)",
      })
    },
    [toast],
  )

  const activeRevision =
    LAB_NOTEBOOK_HISTORY.find((revision) => revision.id === activeRevisionId) ?? null

  return (
    <div className="app-lab-pane flex flex-col gap-3">
      {/* Scoped token colors for `highlightNotebookCode`'s nb-* spans; the
          dark variant swaps the palette so the notebook has its own
          light/dark syntax highlighting independent of app.css. */}
      <style>{`
        [data-nb-theme="light"] .nb-kw { color: #7c3aed; }
        [data-nb-theme="light"] .nb-const { color: #b45309; }
        [data-nb-theme="light"] .nb-str { color: #15803d; }
        [data-nb-theme="light"] .nb-num { color: #0369a1; }
        [data-nb-theme="dark"] .nb-kw { color: #c4b5fd; }
        [data-nb-theme="dark"] .nb-const { color: #fbbf24; }
        [data-nb-theme="dark"] .nb-str { color: #6ee7b7; }
        [data-nb-theme="dark"] .nb-num { color: #7dd3fc; }
      `}</style>
      <div className="app-lab-pane-title">analysis.ipynb — JupyterLab</div>

      {/* ---- Notebook toolbar ---- */}
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`app-badge ${kernelBadgeClass(kernelStatus)}`}
          role="status"
          title={`CPU ${kernelCpu}% · memory ${kernelMemoryLabel}`}
        >
          {kernelStatusLabel(kernelStatus)} · CPU {kernelCpu}% · MEM {kernelMemoryLabel}
        </span>
        <button type="button" className="fm-btn" onClick={handleDownload}>
          <Download aria-hidden="true" className="size-3.5" />
          Download
        </button>
        <div className="w-48 min-w-36">
          <Select
            id="lab-notebook-template"
            aria-label="Notebook template"
            options={LAB_NOTEBOOK_TEMPLATES.map((candidate) => ({
              value: candidate.id,
              label: candidate.name,
            }))}
            value={template.id}
            onChange={handleTemplateChange}
          />
        </div>
        <div className="w-36 min-w-32">
          <Select
            id="lab-notebook-export-format"
            aria-label="Notebook export format"
            options={NOTEBOOK_EXPORT_FORMATS.map((option) => ({
              value: option.id,
              label: option.label,
            }))}
            value={exportFormat}
            onChange={(next) => {
              if (typeof next === "string") setExportFormat(next as NotebookExportFormat)
            }}
          />
        </div>
        <button type="button" className="fm-btn" onClick={handleExport}>
          <FileDown aria-hidden="true" className="size-3.5" />
          Export
        </button>
        <button
          type="button"
          className="fm-btn"
          onClick={handleExportTable}
          disabled={!activeTableOutput}
          title={
            activeTableOutput
              ? "Download the active cell's table as CSV"
              : "The active cell has no table output"
          }
        >
          <Table aria-hidden="true" className="size-3.5" />
          Export table
        </button>
        <button
          type="button"
          className="fm-btn"
          aria-pressed={notebookTheme === "dark"}
          onClick={toggleNotebookTheme}
        >
          {notebookTheme === "dark" ? (
            <Sun aria-hidden="true" className="size-3.5" />
          ) : (
            <Moon aria-hidden="true" className="size-3.5" />
          )}
          {notebookTheme === "dark" ? "Light theme" : "Dark theme"}
        </button>
        <div className="w-44 min-w-36">
          <Input
            type="search"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search notebook…"
            aria-label="Search notebook cells"
            className="h-8 text-xs"
          />
        </div>
        <button
          type="button"
          className="fm-btn"
          disabled={!commentTargetId}
          onClick={() => commentTargetId && openCellComment(commentTargetId)}
        >
          <MessageSquarePlus aria-hidden="true" className="size-3.5" />
          Comment on current cell
        </button>
        <button
          type="button"
          className="fm-btn"
          onClick={handleRestart}
          disabled={kernelStatus === "restarting"}
        >
          <RotateCcw aria-hidden="true" className="size-3.5" />
          Restart kernel
        </button>
        <button
          type="button"
          className="fm-btn fm-btn--danger"
          onClick={handleInterrupt}
          disabled={kernelStatus !== "busy"}
        >
          <Square aria-hidden="true" className="size-3.5" />
          Interrupt
        </button>
        <button
          type="button"
          className="fm-btn"
          aria-pressed={cellsCollapsed}
          onClick={() => setCellsCollapsed((previous) => !previous)}
        >
          {cellsCollapsed ? (
            <ChevronsUpDown aria-hidden="true" className="size-3.5" />
          ) : (
            <ChevronsDownUp aria-hidden="true" className="size-3.5" />
          )}
          {cellsCollapsed ? "Expand cells" : "Collapse cells"}
        </button>
        <button
          type="button"
          className="fm-btn"
          aria-pressed={allOutputsHidden}
          onClick={toggleAllCellOutputs}
          disabled={cellsWithOutputs.length === 0}
        >
          {allOutputsHidden ? (
            <Eye aria-hidden="true" className="size-3.5" />
          ) : (
            <EyeOff aria-hidden="true" className="size-3.5" />
          )}
          {allOutputsHidden ? "Show cell outputs" : "Hide cell outputs"}
        </button>
        <button
          type="button"
          className="fm-btn"
          aria-pressed={showHistory}
          onClick={() => setShowHistory((previous) => !previous)}
        >
          <History aria-hidden="true" className="size-3.5" />
          Notebook history
        </button>
        <span className="app-field-hint" aria-live="polite">
          Cells executed: {cellsRun} of {codeCells.length} · {totalRuns}{" "}
          {totalRuns === 1 ? "run" : "runs"}
        </span>
        <Input
          type="search"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Filter rows…"
          aria-label="Filter notebook table rows"
          className="h-8 w-40 text-xs"
        />
        <CopyButton
          // Evaluated lazily on click so `window` is only touched in the
          // browser; preserves unrelated query params.
          text={() =>
            labNotebookShareHref(
              shareState,
              window.location.pathname,
              window.location.search,
            )
          }
          label="Share notebook"
        />
        {activeRevision ? (
          <span className="app-field-hint ml-auto">
            Revision {activeRevision.label} · {activeRevision.author}
          </span>
        ) : null}
      </div>

      {searchTerm ? (
        <p className="app-field-hint m-0" role="status">
          {visibleCells.length === 0
            ? `No cells match “${searchQuery.trim()}”.`
            : `${visibleCells.length} of ${cells.length} cells match “${searchQuery.trim()}”.`}
        </p>
      ) : null}

      {/* ---- Resizable split: notebook | console ---- */}
      <div
        ref={splitRef}
        className="flex min-h-72"
        style={{ height: 420 }}
        data-testid="notebook-split"
      >
        <div
          className="min-w-0 overflow-y-auto pr-2"
          style={{ width: `${splitPct}%` }}
          aria-label="Notebook cells"
          data-nb-theme={notebookTheme}
        >
          <div className="space-y-3">
            {visibleCells.length === 0 ? (
              <p className="app-field-hint">No cells to show.</p>
            ) : null}
            {visibleCells.map((cell) => (
              <NotebookCellView
                key={cell.id}
                cell={cell}
                runState={cellRuns[cell.id]}
                collapsed={cellsCollapsed}
                outputsHidden={hiddenOutputs.has(cell.id)}
                appendedRows={appendedRows}
                filter={filter}
                exportPrefix={template.id}
                runDisabled={kernelStatus !== "idle"}
                theme={notebookTheme}
                isActive={cell.id === activeCellId}
                onActivate={() => setActiveCellId(cell.id)}
                comments={commentsByCell[cell.id] ?? []}
                commentOpen={openCommentCellId === cell.id}
                commentDraft={commentDraft}
                onCommentDraftChange={setCommentDraft}
                onComment={() => openCellComment(cell.id)}
                onSaveComment={() => saveCellComment(cell.id)}
                onCancelComment={() => {
                  setOpenCommentCellId(null)
                  setCommentDraft("")
                }}
                onRun={() => handleRunCell(cell)}
                onToggleOutputs={() => toggleCellOutputs(cell.id)}
              />
            ))}
          </div>
        </div>

        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize notebook and console panes"
          aria-valuenow={Math.round(splitPct)}
          aria-valuemin={SPLIT_MIN_PCT}
          aria-valuemax={SPLIT_MAX_PCT}
          tabIndex={0}
          className="mx-1 w-1 shrink-0 cursor-col-resize rounded-full bg-[var(--app-border)] transition-colors hover:bg-[var(--app-accent)] focus-visible:bg-[var(--app-accent)] focus-visible:outline-none"
          onPointerDown={(event) => {
            draggingRef.current = true
            event.currentTarget.setPointerCapture(event.pointerId)
          }}
          onPointerMove={(event) => {
            if (draggingRef.current) updateSplitFromClientX(event.clientX)
          }}
          onPointerUp={(event) => {
            draggingRef.current = false
            event.currentTarget.releasePointerCapture(event.pointerId)
          }}
          onPointerCancel={() => {
            draggingRef.current = false
          }}
          onKeyDown={handleSplitKeyDown}
        />

        <div className="flex min-w-0 flex-1 flex-col pl-2">
          <div className="app-lab-pane-title mb-1">Console</div>
          <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] p-2">
            {consoleLines.length === 0 ? (
              <p className="text-xs text-[var(--app-text-muted)]">No kernel output yet.</p>
            ) : (
              <ul className="space-y-1">
                {consoleLines.map((line, index) => (
                  <li
                    key={`${index}-${line}`}
                    className="font-mono text-xs whitespace-pre-wrap text-[var(--app-text)]"
                  >
                    {line}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      {/* ---- Notebook history ---- */}
      {showHistory ? (
        <section className="app-panel" aria-labelledby="lab-notebook-history-heading">
          <div className="app-panel-head">
            <div>
              <h2 id="lab-notebook-history-heading">Notebook history</h2>
              <p>Checkpoints recorded for analysis.ipynb, newest first.</p>
            </div>
          </div>
          {LAB_NOTEBOOK_HISTORY.length === 0 ? (
            <p className="app-field-hint">No revisions recorded yet.</p>
          ) : (
            <ul className="app-lab-run-list">
              {LAB_NOTEBOOK_HISTORY.map((revision) => {
                const active = revision.id === activeRevisionId
                return (
                  <li key={revision.id}>
                    <div
                      className={`app-lab-run-row${active ? "is-selected" : ""}`}
                      aria-current={active || undefined}
                    >
                      <span className="app-lab-run-main">
                        <strong>
                          {revision.label}
                          {active ? <span className="app-badge is-baseline">Current</span> : null}
                        </strong>
                        <span className="app-lab-run-meta">
                          {revision.author} · {formatRelativeTime(revision.createdAt)} ·{" "}
                          {formatDateTime(revision.createdAt)}
                        </span>
                        <span className="app-field-hint">{revision.summary}</span>
                      </span>
                      <span className="app-lab-run-side">
                        <button
                          type="button"
                          className="fm-btn"
                          disabled={active}
                          onClick={() => handleRestoreRevision(revision.id)}
                        >
                          <RotateCcw aria-hidden="true" className="size-3.5" />
                          Restore
                        </button>
                      </span>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      ) : null}
    </div>
  )
}
